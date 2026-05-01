import oracledb from "oracledb";
import dotenv from "dotenv";
dotenv.config();

async function initOracleConnection() {
  try {
    await oracledb.createPool({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECT_STRING,
    });
    console.log("✅ Connected to Oracle XE!");
  } catch (err) {
    console.error("❌ Oracle connection error:", err);
  }
}

export default initOracleConnection;

