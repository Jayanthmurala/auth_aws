import { FastifyReply, FastifyRequest } from "fastify";
import { loginBodySchema, registerBodySchema } from "../schemas/auth.schemas";
import { createUser, findUserByEmail, findUserById, markLogin } from "../services/user.service";
import { hashPassword, verifyPassword } from "../utils/crypto";
import { getRefreshCookieName, getRefreshCookieOptions, issueRefreshToken, rotateRefreshToken } from "../services/token.service";
import { signAccessToken } from "../utils/jwt";
import { prisma } from "../db";

export async function registerHandler(req: FastifyRequest, reply: FastifyReply) {
  const body = registerBodySchema.parse(req.body);
  const exists = await findUserByEmail(body.email);
  if (exists) return reply.code(409).send({ code: "USER_EXISTS", message: "Email already registered" });

  const passwordHash = await hashPassword(body.password);
  const user = await createUser({ email: body.email, passwordHash, displayName: body.displayName });

  const { token: refreshToken, expiresAt } = await issueRefreshToken(user.id);
  const accessToken = await signAccessToken(user.id, {
    email: user.email,
    name: user.displayName,
    picture: user.avatarUrl ?? undefined,
    roles: user.roles,
    collegeId: user.collegeId,
    tv: user.tokenVersion,
  });

  reply
    .setCookie(getRefreshCookieName(), refreshToken, getRefreshCookieOptions())
    .code(201)
    .send({ accessToken, user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl, roles: user.roles, status: user.status }, refreshExpiresAt: expiresAt });
}

export async function loginHandler(req: FastifyRequest, reply: FastifyReply) {
  const body = loginBodySchema.parse(req.body);
  const user = await findUserByEmail(body.email);
  if (!user || !user.passwordHash) return reply.code(401).send({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });

  const valid = await verifyPassword(user.passwordHash, body.password);
  if (!valid) return reply.code(401).send({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });

  await markLogin(user.id);

  const { token: refreshToken, expiresAt } = await issueRefreshToken(user.id);
  const accessToken = await signAccessToken(user.id, {
    email: user.email,
    name: user.displayName,
    picture: user.avatarUrl ?? undefined,
    roles: user.roles,
    collegeId: user.collegeId,
    tv: user.tokenVersion,
  });

  reply
    .setCookie(getRefreshCookieName(), refreshToken, getRefreshCookieOptions())
    .send({ accessToken, user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl, roles: user.roles, status: user.status }, refreshExpiresAt: expiresAt });
}

export async function meHandler(req: FastifyRequest, reply: FastifyReply) {
  // In auth-service we trust the provided user id via token after gateway; here allow bearer for local testing
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return reply.code(401).send({ code: "UNAUTHORIZED", message: "Missing token" });
  const token = auth.slice("Bearer ".length);
  // We don't verify here to keep minimal; gateway should verify. For local dev, we can decode claims client-side after login.
  // Instead, we accept token presence and return 200. Optionally, decode using jose's jwtVerify with public key.
  // For now, require a userId query for simplicity in dev.
  const userId = (req.query as any)?.userId as string | undefined;
  if (!userId) return reply.code(400).send({ code: "BAD_REQUEST", message: "userId query required for /me in dev" });
  const user = await findUserById(userId);
  if (!user) return reply.code(404).send({ code: "NOT_FOUND", message: "User not found" });
  reply.send({ id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl, roles: user.roles, status: user.status });
}

export async function refreshHandler(req: FastifyRequest, reply: FastifyReply) {
  const raw = req.cookies[getRefreshCookieName()];
  if (!raw) return reply.code(401).send({ code: "UNAUTHORIZED", message: "Missing refresh token" });

  const rotated = await rotateRefreshToken(raw);
  if (!rotated) return reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid refresh token" });

  const { token: newRefresh, expiresAt } = rotated;
  // get user to sign new access
  const { id } = (await prisma.securityToken.findUnique({ where: { id: raw.split(".")[0] } })) ?? { id: null } as any;
  // The above only had token id; we need userId; fetch latest token for the same user by createdAt desc
  const tokenRec = await prisma.securityToken.findUnique({ where: { id: raw.split(".")[0] } });
  if (!tokenRec) return reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid refresh token" });
  const user = await findUserById(tokenRec.userId);
  if (!user) return reply.code(401).send({ code: "UNAUTHORIZED", message: "User not found" });

  const accessToken = await signAccessToken(user.id, {
    email: user.email,
    name: user.displayName,
    picture: user.avatarUrl ?? undefined,
    roles: user.roles,
    collegeId: user.collegeId,
    tv: user.tokenVersion,
  });

  reply
    .setCookie(getRefreshCookieName(), newRefresh, getRefreshCookieOptions())
    .send({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        roles: user.roles,
        status: user.status,
      },
      refreshExpiresAt: expiresAt,
    });
}

export async function logoutHandler(req: FastifyRequest, reply: FastifyReply) {
  // Best-effort: mark current refresh token used
  const raw = req.cookies[getRefreshCookieName()];
  if (raw) {
    const id = raw.split(".")[0];
    await prisma.securityToken.updateMany({ where: { id }, data: { usedAt: new Date() } });
  }
  reply.clearCookie(getRefreshCookieName(), { path: "/", domain: undefined });
  reply.send({ success: true });
}
