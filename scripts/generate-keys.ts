import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';

async function main() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
  const pkcs8 = await exportPKCS8(privateKey);
  const spki = await exportSPKI(publicKey);
  const esc = (s: string) => s.replace(/\r?\n/g, '\\n');
  const kid = `auth-key-${Math.floor(Date.now() / 1000)}`;

  console.log('Add these to auth-service/.env:');
  console.log(`AUTH_JWT_PRIVATE_KEY="${esc(pkcs8)}"`);
  console.log(`AUTH_JWT_PUBLIC_KEY="${esc(spki)}"`);
  console.log(`AUTH_JWT_KID="${kid}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
