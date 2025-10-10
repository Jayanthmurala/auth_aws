import { FastifyInstance } from "fastify";
import { getJWKS } from "../utils/jwt";

export default async function jwksRoutes(app: FastifyInstance) {
  app.get("/.well-known/jwks.json", async () => {
    return getJWKS();
  });
}
