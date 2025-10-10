import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const pkcs8 = await exportPKCS8(privateKey);
const spki = await exportSPKI(publicKey);

const esc = (s) => s.replace(/\n/g, '\\n');

console.log('AUTH_JWT_PRIVATE_KEY="' + esc(pkcs8) + '"');
console.log('AUTH_JWT_PUBLIC_KEY="' + esc(spki) + '"');
console.log('\n# Paste these into your .env (replace the placeholder ... values).');
