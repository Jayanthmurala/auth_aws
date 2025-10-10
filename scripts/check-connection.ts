import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const schema = 'authsvc';

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`SET search_path TO ${schema}`);

    const cur = await client.query('select current_schema() as schema');
    console.log('Connected. current_schema =', cur.rows[0].schema);

    const res = await client.query(
      `SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
      [schema]
    );
    console.log('Tables in schema', schema, res.rows);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
