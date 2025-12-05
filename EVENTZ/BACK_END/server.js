// server.js — Evenz backend (corrected & cleaned)
// Make a backup of your existing server.js before replacing it.

require("dotenv").config();
const { jsPDF } = require("jspdf");
const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcrypt");
const multer = require("multer");
const bodyParser = require("body-parser");
const oracledb = require("oracledb");
const fs = require("fs");
const session = require("express-session");
// ---------- CONFIG ----------
const PORT = process.env.PORT || 5000;
const SCHEMA = process.env.DB_SCHEMA || "EVENTZ"; // keep a single place for schema name

const dbConfig = {
  user: process.env.DB_USER || "EVENTZ",
  password: process.env.DB_PASSWORD || "jhasu001",
  connectString: process.env.DB_CONNECTION_STRING || "localhost:1521/XEPDB1",
  poolMin: 1,
  poolMax: 10,
  poolIncrement: 1,
};


// ---------- APP & POOL ----------
const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(cors({
  origin: "http://localhost:5500", // or your frontend URL
  credentials: true
}));
app.use(session({
  secret: "eventzone-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // true only if HTTPS
}));
// Use object format for clarity
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
// Create pool
(async function initPool() {
  try {
    await oracledb.createPool(dbConfig);
    console.log("✅ Oracle pool created");
  } catch (err) {
    console.error("❌ Error creating Oracle pool:", err);
    process.exit(1);
  }
})();

const getConn = async () => {
  // getConnection() uses pool by default if pool exists
  return await oracledb.getConnection();
};

// ---------- MULTER (file upload) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../frontend/uploads")),
  filename: (req, file, cb) => cb(null, (req.body.username || "anon") + path.extname(file.originalname)),
});
const upload = multer({ storage });

// ---------- STATIC SERVE ----------
app.use("/assets", express.static(path.join(__dirname, "../frontend/assets")));
app.use("/uploads", express.static(path.join(__dirname, "../frontend/uploads")));
app.use(express.static(path.join(__dirname, "../frontend")));

// ---------- HELPERS ----------
function safeClose(conn) {
  if (!conn) return;
  try {
    conn.close();
  } catch (e) {
    console.warn("Warning closing connection:", e);
  }
}

function schemaTable(tableName) {
  // returns qualified table name like EVENTZ.EVENTS
  return `${SCHEMA}.${tableName}`;
}

// ---------- ROUTES ----------

// Health check
app.get("/api/test", (req, res) => res.json({ success: true, message: "✅ Backend is running fine!" }));

// Debug: who am i (connected DB user)
app.get("/api/whoami", async (req, res) => {
  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(`SELECT USER FROM DUAL`);
    // result.rows is [{ USER: 'EVENTZ' }]
    res.json({ connected_as: result.rows[0].USER });
  } catch (err) {
    console.error("whoami error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// Debug: test events simple select (unqualified)
app.get("/api/test-events", async (req, res) => {
  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(`SELECT EVENT_NAME FROM ${schemaTable("EVENTS")} FETCH FIRST 5 ROWS ONLY`);
    res.json({ rows: result.rows });
  } catch (err) {
    console.error("test-events error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});
// ---------- AUTH: CURRENT USER ----------
// ================= RECEIPT SYSTEM ROUTES =================

// ✅ Get current logged-in user (example using session)
app.get("/api/current-user", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "Not logged in" });
  }

  const user = req.session.user;

  // For regular users, verify data from DB (optional but safer)
  if (user.ROLE === "user") {
    let conn;
    try {
      conn = await getConn();
      const sql = `
        SELECT ID, USERNAME, FULLNAME, EMAIL, PHONE, PROFILEPIC 
        FROM USERS 
        WHERE USERNAME = :username
      `;
      const result = await conn.execute(sql, { username: user.USERNAME }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      await conn.close();

      if (result.rows.length === 0)
        return res.status(404).json({ success: false, message: "User not found" });

      return res.json({ success: true, user: result.rows[0] });
    } catch (err) {
      console.error("❌ current-user error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // For admins (from session)
  return res.json({ success: true, user });
});



// ✅ 3️⃣ Generate PDF receipt for a booking

app.get("/api/bookings/:bookingId/receipt", async (req, res) => {
  const bookingId = req.params.bookingId;
  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    // Fetch booking + event info
    const result = await connection.execute(
      `SELECT 
  b.ID AS BOOKING_ID,
  e.NAME AS EVENT_NAME,
  e.EVENT_DATE,
  e.CITY,
  e.VENUE,
  b.PLAN,
  b.GUESTS,
  b.BOOKING_DATE,
  b.PRICE,
  b.STATUS,
  b.COUPON_CODE
FROM BOOKINGS b
JOIN EVENTS e ON b.EVENT_ID = e.ID
WHERE b.ID = :bookingId`,
      [bookingId],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    const b = result.rows[0];

    // 🧾 Generate PDF
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Event Zone - Receipt", 70, 20);

    doc.setFontSize(12);
    doc.text(`Booking ID: ${b.ID}`, 20, 40);
    doc.text(`User: ${b.USERNAME}`, 20, 50);
    doc.text(`Event: ${b.EVENT_NAME}`, 20, 60);
    doc.text(`Plan: ${b.PLAN}`, 20, 70);
    doc.text(`Guests: ${b.GUESTS}`, 20, 80);
    doc.text(`Booking Date: ${b.BOOKING_DATE}`, 20, 90);
    doc.text(`Payment Date: ${b.PAYMENT_DATE || "N/A"}`, 20, 100);
    doc.text(`Status: ${b.STATUS}`, 20, 110);
    doc.text(`Coupon Code: ${b.COUPON_CODE || "None"}`, 20, 120);
    doc.text(`Price: ₹${b.PRICE}`, 20, 130);

    // Send as PDF response
    const pdfBytes = doc.output();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=receipt_${bookingId}.pdf`);
    res.send(Buffer.from(pdfBytes, "binary"));

  } catch (err) {
    console.error("❌ Error generating receipt PDF:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

// ---------- AUTH: LOGOUT ----------
app.post("/api/logout", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(400).json({
      success: false,
      message: "No active session to log out from",
    });
  }

  const username = req.session.user.USERNAME || req.session.user.username;

  req.session.destroy((err) => {
    if (err) {
      console.error("❌ Error destroying session:", err);
      return res.status(500).json({
        success: false,
        message: "Logout failed. Please try again.",
      });
    }

    res.clearCookie("connect.sid", { path: "/" }); // 🧹 clear session cookie
    console.log(`🚪 User logged out: ${username}`);
    return res.json({
      success: true,
      message: "Logged out successfully",
    });
  });
});



// ---------- AUTH: SIGNUP ----------
app.post("/api/signup", async (req, res) => {
  const { fullName, email, username, password } = req.body;
  if (!fullName || !email || !username || !password)
    return res.status(400).json({ success: false, message: "All fields are required" });

  let conn;
  try {
    conn = await getConn();

    const checkSql = `SELECT COUNT(*) AS CNT FROM ${schemaTable("USERS")} WHERE username = :username OR email = :email`;
    const check = await conn.execute(checkSql, { username, email });
    const existing = check.rows[0].CNT || 0;

    if (existing > 0) {
      return res.status(400).json({ success: false, message: "Username or email already exists!" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const insertSql = `INSERT INTO ${schemaTable("USERS")} (FULLNAME, EMAIL, USERNAME, PASSWORD)
                       VALUES (:fullName, :email, :username, :password)`;
    await conn.execute(insertSql, { fullName, email, username, password: hashed }, { autoCommit: true });

    res.json({ success: true, message: "Signup successful!" });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// ---------- AUTH: LOGIN ----------
app.post("/api/login", async (req, res) => {
  const { role, username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Missing username or password",
    });
  }

  // ✅ Admin login (static list)
  if (role === "admin") {
    const admins = [
      { username: "admin", password: "admin123", fullName: "System Admin" },
      { username: "admin_Likith", password: "likith123", fullName: "Main Admin" },
      { username: "eventz_master", password: "eventz123", fullName: "EventZ Manager" },
    ];

    const admin = admins.find(
      (a) => a.username === username && a.password === password
    );

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }

    // ✅ Store admin in session
    req.session.user = {
      ID: 0,
      USERNAME: admin.username,
      FULLNAME: admin.fullName,
      ROLE: "admin",
    };

    console.log(`✅ Admin logged in: ${admin.username}`);
    return res.json({
      success: true,
      username: admin.username,
      fullName: admin.fullName,
      role: "admin",
    });
  }

  // ✅ Regular user login (database)
  let conn;
  try {
    conn = await getConn();

    const sql = `
      SELECT ID, USERNAME, FULLNAME, PASSWORD 
      FROM USERS 
      WHERE USERNAME = :username
    `;
    const result = await conn.execute(
      sql,
      { username },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.PASSWORD);

    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    // ✅ Save to session
    req.session.user = {
      ID: user.ID,
      USERNAME: user.USERNAME,
      FULLNAME: user.FULLNAME,
      ROLE: "user",
    };

    console.log(`✅ User logged in: ${user.USERNAME} (ID: ${user.ID})`);

    res.json({
      success: true,
      id: user.ID,
      username: user.USERNAME,
      fullName: user.FULLNAME,
      role: "user",
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  } finally {
    if (conn) await conn.close();
  }
});


// ---------- CITIES ----------
const cities = [
  { name: "Vijayawada", icon: "https://img.images8.com/ios-filled/70/000000/city.png" },
  { name: "Visakhapatnam", icon: "https://img.images8.com/ios-filled/70/000000/beach.png" },
  { name: "Guntur", icon: "https://img.images8.com/ios-filled/70/000000/monument.png" },
  { name: "Nellore", icon: "https://img.images8.com/ios-filled/70/000000/temple.png" },
  { name: "Tirupati", icon: "https://img.images8.com/ios-filled/70/000000/temple.png" },
  { name: "Kurnool", icon: "https://img.images8.com/ios-filled/70/000000/bridge.png" },
  { name: "Rajahmundry", icon: "https://img.images8.com/ios-filled/70/000000/soil.png" },
  { name: "Kakinada", icon: "https://img.images8.com/ios-filled/70/000000/city.png" },
  { name: "Eluru", icon: "https://img.images8.com/ios-filled/70/000000/building.png" },
  { name: "Anantapur", icon: "https://img.images8.com/ios-filled/70/000000/palace.png" },
];
app.get("/api/cities", (req, res) => res.json({ success: true, cities }));

// ---------- SEND OTP ----------
app.post("/api/send-otp", async (req, res) => {
  const { input } = req.body;
  if (!input) return res.status(400).json({ success: false, message: "Input required" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
  let conn;
  try {
    conn = await getConn();

    const userCheckSql = `SELECT USERNAME FROM ${schemaTable("USERS")} WHERE USERNAME = :input OR EMAIL = :input`;
    const userCheck = await conn.execute(userCheckSql, { input });

    if (!userCheck.rows || userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    await conn.execute(
      `DELETE FROM ${schemaTable("PASSWORD_OTPS")} WHERE user_input = :input`,
      { input },
      { autoCommit: true }
    );

    await conn.execute(
      `INSERT INTO ${schemaTable("PASSWORD_OTPS")} (user_input, otp, expires_at)
       VALUES (:input, :otp, SYSTIMESTAMP + INTERVAL '5' MINUTE)`,
      { input, otp },
      { autoCommit: true }
    );

    console.log(`✅ OTP generated for ${input}: ${otp}`);
    res.json({ success: true, message: "OTP generated (valid 5 mins)", otp }); // remove otp in production
  } catch (err) {
    console.error("OTP generation error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// ---------- RESET PASSWORD ----------
app.post("/api/reset-password", async (req, res) => {
  const { input, otp, newPassword } = req.body;
  if (!input || !otp || !newPassword)
    return res.status(400).json({ success: false, message: "input, otp and newPassword required" });

  let conn;
  try {
    conn = await getConn();

    const otpSql = `SELECT otp, TO_CHAR(expires_at, 'YYYY-MM-DD HH24:MI:SS') AS expires FROM ${schemaTable("PASSWORD_OTPS")} WHERE user_input = :input`;
    const otpResult = await conn.execute(otpSql, { input });

    if (!otpResult.rows || otpResult.rows.length === 0)
      return res.status(400).json({ success: false, message: "Invalid or expired OTP." });

    const { OTP: dbOtp, EXPIRES: expiresStr } = otpResult.rows[0]; // may be uppercase keys
    const dbOtpVal = otpResult.rows[0].OTP || otpResult.rows[0].otp;
    const expiresAt = new Date(otpResult.rows[0].EXPIRES || otpResult.rows[0].expires);

    if (expiresAt.getTime() < Date.now()) {
      await conn.execute(`DELETE FROM ${schemaTable("PASSWORD_OTPS")} WHERE user_input = :input`, { input }, { autoCommit: true });
      return res.status(400).json({ success: false, message: "OTP expired. Request a new one." });
    }

    if (String(otp).trim() !== String(dbOtpVal).trim()) {
      return res.status(400).json({ success: false, message: "Invalid OTP." });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    const updateSql = `UPDATE ${schemaTable("USERS")} SET PASSWORD = :password WHERE USERNAME = :input OR EMAIL = :input`;
    const updateRes = await conn.execute(updateSql, { password: hashed, input }, { autoCommit: true });

    if (updateRes.rowsAffected === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    await conn.execute(`DELETE FROM ${schemaTable("PASSWORD_OTPS")} WHERE user_input = :input`, { input }, { autoCommit: true });
    res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    console.error("reset-password error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// ======================== USER PROFILE ROUTES ========================
app.get("/api/user/:username", async (req, res) => {
  const username = req.params.username?.trim();
  if (!username)
    return res.status(400).json({ success: false, message: "Username required" });

  let conn;
  try {
    conn = await getConn();
    const sql = `
      SELECT USERNAME, FULLNAME, EMAIL, PHONE, PROFILEPIC
      FROM ${schemaTable("USERS")}
      WHERE USERNAME = :username
    `;
    const result = await conn.execute(sql, { username }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    if (!result.rows || result.rows.length === 0)
      return res.status(404).json({ success: false, message: "User not found" });

    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error("❌ fetch user error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});
app.post("/api/update-profile", async (req, res) => {
  const { username, fullName, email, phone, profilePic } = req.body;

  if (!username)
    return res.status(400).json({ success: false, message: "Username required" });

  let conn;
  try {
    conn = await getConn();
    const sql = `
      UPDATE ${schemaTable("USERS")}
      SET FULLNAME = :fullName,
          EMAIL = :email,
          PHONE = :phone,
          PROFILEPIC = NVL(:profilePic, PROFILEPIC)
      WHERE USERNAME = :username
    `;

    const result = await conn.execute(
      sql,
      { fullName, email, phone, profilePic, username },
      { autoCommit: true }
    );

    if (result.rowsAffected === 0)
      return res.status(404).json({ success: false, message: "User not found" });

    res.json({ success: true, message: "Profile updated successfully" });
  } catch (err) {
    console.error("❌ update-profile error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


// 🟢 Upload profile picture
app.post("/api/upload-profile-pic", upload.single("profilePic"), async (req, res) => {
  if (!req.file)
    return res.status(400).json({ success: false, message: "No file uploaded" });

  const username = req.body.username?.trim();
  if (!username)
    return res.status(400).json({ success: false, message: "Username required" });

  const filePath = `uploads/${req.file.filename}`; // Save relative path

  let conn;
  try {
    conn = await getConn();
    const sql = `
      UPDATE ${schemaTable("USERS")} 
      SET PROFILEPIC = :filePath 
      WHERE USERNAME = :username
    `;
    const result = await conn.execute(sql, { filePath, username }, { autoCommit: true });

    if (result.rowsAffected === 0)
      return res.status(404).json({ success: false, message: "User not found" });

    res.json({ success: true, message: "Profile picture updated", filePath });
  } catch (err) {
    console.error("❌ upload-profile-pic error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// ✅ Verify Current Password
app.post("/api/verify-password", async (req, res) => {
  const { username, currentPass } = req.body;
  if (!username || !currentPass)
    return res.status(400).json({ success: false, message: "Username and password required" });

  let conn;
  try {
    conn = await getConn();
    const sql = `SELECT PASSWORD FROM ${schemaTable("USERS")} WHERE USERNAME = :username`;
    const result = await conn.execute(sql, { username });

    if (!result.rows || result.rows.length === 0)
      return res.status(404).json({ success: false, message: "User not found" });

    const storedHash = result.rows[0][0];
    const match = await bcrypt.compare(currentPass, storedHash);

    if (!match)
      return res.status(401).json({ success: false, message: "Invalid current password" });

    res.json({ success: true, message: "Password verified" });
  } catch (err) {
    console.error("verify-password error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


// ✅ Update Password
app.post("/api/update-password", async (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword)
    return res.status(400).json({ success: false, message: "Username and new password required" });

  let conn;
  try {
    conn = await getConn();

    // Hash the new password securely
    const hashed = await bcrypt.hash(newPassword, 10);

    const sql = `UPDATE ${schemaTable("USERS")} SET PASSWORD = :hashed WHERE USERNAME = :username`;
    const result = await conn.execute(sql, { hashed, username }, { autoCommit: true });

    if (result.rowsAffected === 0)
      return res.status(404).json({ success: false, message: "User not found" });

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("update-password error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


// ---------- HIGHLIGHTS ----------
app.get("/api/highlights", (req, res) => {
  const defaultEvents = [
    { id: 1, name: "Birthday", image: "assets/images/cake.jpeg" },
    { id: 2, name: "Anniversary", image: "assets/images/wedding.jpeg" },
    { id: 3, name: "Meeting", image: "assets/images/discussion.jpeg" },
    { id: 4, name: "Graduation", image: "assets/images/graduation.jpeg" },
    { id: 5, name: "Concert", image: "assets/images/singer.jpeg" },
    { id: 6, name: "Festivals", image: "assets/images/fest.jpeg" },
    { id: 7, name: "Charity", image: "assets/images/charity.jpeg" },
    { id: 8, name: "Reunion", image: "assets/images/reunion.jpeg" },
    { id: 9, name: "Farewell", image: "assets/images/fare.jpeg" },
    { id: 10, name: "Marriage", image: "assets/images/marriage.jpeg" },
    { id: 11, name: "Engagement", image: "assets/images/engage.jpeg" },
    { id: 12, name: "Baby Shower", image: "assets/images/baby.jpeg" },
    { id: 13, name: "College Events", image: "assets/images/college.jpeg" },
    { id: 14, name: "Customized...", image: "assets/images/customized.jpeg" },
  ];
  res.json({ success: true, highlights: defaultEvents });
});
// =================================================
// 🔹 Utility: Schema wrapper (if you’re using your own schema name)
function schemaTable(name) {
  return `EVENTZ.${name}`; // ❗ change "EVENTZ" to your actual schema if needed
}
// server.js - FULLY CORRECTED API ENDPOINTS
// FINAL UNIFIED CODE BLOCK (Using ID and NAME columns for EVENTS)

// =============================================================
// ✅ 1️⃣ FETCH ALL EVENTS (ONLY DEFAULT ICON EVENTS)
// =============================================================
app.get("/api/events", async (req, res) => {
  const defaultEvents = [
    { title: "Birthday", icon: "assets/icons/cake.png" },
    { title: "Anniversary", icon: "assets/icons/wedding.png" },
    { title: "Meeting", icon: "assets/icons/discussion.png" },
    { title: "Graduation", icon: "assets/icons/graduation-hat-and-diploma.png" },
    { title: "Concert", icon: "assets/icons/singer.png" },
    { title: "Festivals", icon: "assets/icons/tent.png" },
    { title: "Charity", icon: "assets/icons/globe.png" },
    { title: "Reunion", icon: "assets/icons/users.png" },
    { title: "Farewell", icon: "assets/icons/waving-goodbye.png" },
    { title: "Marriage", icon: "assets/icons/bridal.png" },
    { title: "Engagement", icon: "assets/icons/engagement-ring.png" },
    { title: "Baby Shower", icon: "assets/icons/baby-shower.png" },
    { title: "College Events", icon: "assets/icons/calendar.png" },
    { title: "Customized...", icon: "assets/icons/catering.png" },
  ];

  // Just send the default events, no DB call
  res.json({ success: true, events: defaultEvents });
});

// ==================== GET ALL BOOKINGS (CART) FOR A USER ====================
app.get("/api/cart/:userId", async (req, res) => {
const userId = req.params.userId;
  let conn;

  try {
    conn = await getConn();

    const sql = `
      SELECT
        b.id AS BOOKING_ID,
        u.username AS USERNAME,
        e.name AS EVENT_NAME,
        e.city AS EVENT_CITY,
        e.venue AS EVENT_VENUE,
        TO_CHAR(e.event_date, 'YYYY-MM-DD') AS EVENT_DATE,
        b.plan AS PLAN,
        b.guests AS GUESTS,
        b.price AS PRICE,
        b.status AS STATUS,
        TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS BOOKING_DATE
      FROM bookings b
      JOIN events e ON b.event_id = e.id
      JOIN users u ON b.user_id = u.id
      WHERE b.user_id = :userId
      ORDER BY b.booking_date DESC
    `;

    const result = await conn.execute(sql, { userId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    res.json({ success: true, bookings: result.rows, count: result.rows.length });
  } catch (err) {
    console.error("❌ Error fetching cart bookings:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


// ==================== CANCEL BOOKING BY ID ====================
app.delete("/api/cart/:bookingId", async (req, res) => {
  const bookingId = parseInt(req.params.bookingId);
  if (!bookingId)
    return res.status(400).json({ success: false, message: "Invalid booking ID" });

  let conn;
  try {
    conn = await getConn();

    const sql = `DELETE FROM BOOKINGS WHERE ID = :bookingId`;
    const result = await conn.execute(sql, { bookingId }, { autoCommit: true });

    if (result.rowsAffected === 0)
      return res.json({ success: false, message: "Booking not found or already deleted" });

    res.json({ success: true, message: "🗑️ Booking cancelled successfully!" });
  } catch (err) {
    console.error("❌ Cancel booking error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// ✅ 2️⃣ ADD NEW EVENT (FINAL FIX)
// =============================================================
app.post("/api/add-event", async (req, res) => {
    // Ensure EVENT_SEQ is created in your DB!
    const { name, description, event_date, city, venue, created_by } = req.body;
    if (!name || !event_date || !city || !venue) return res.status(400).json({ success: false, message: "Missing required fields" });
    let conn;
    try {
        conn = await getConn();
        // CORRECT SQL: Insert into ID and NAME columns
        const sql = 
        `
          INSERT INTO EVENTS (ID, NAME, DESCRIPTION, EVENT_DATE, CITY, VENUE, CREATED_BY)
            VALUES (EVENT_SEQ.NEXTVAL, :name, :description, TO_DATE(:event_date, 'YYYY-MM-DD'), :city, :venue, :created_by)
        `; 
        await conn.execute(sql, { name, description, event_date, city, venue, created_by }, { autoCommit: true });
        res.json({ success: true, message: "✅ Event added successfully" });
    } catch (err) {
        console.error("❌ Error inserting event:", err);
        res.status(500).json({ success: false, message: "Database insert failed" });
    } finally {
  	if (conn) await conn.close();
  	}
});
// ✅ FINAL: Get bookings for a user (fully correct)
app.get("/api/user-bookings/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: "Invalid user ID" });

  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    const result = await connection.execute(
      `SELECT 
          B.ID AS BOOKING_ID,
          B.PLAN,
          B.PRICE,
          B.STATUS,
          TO_CHAR(B.BOOKING_DATE, 'YYYY-MM-DD') AS BOOKING_DATE,
          B.GUESTS,
          E.NAME AS EVENT_NAME,
          TO_CHAR(E.EVENT_DATE, 'YYYY-MM-DD') AS EVENT_DATE,
          E.CITY,
          E.VENUE
       FROM BOOKINGS B
       INNER JOIN EVENTS E ON B.EVENT_ID = E.ID
       WHERE B.USER_ID = :userId
       ORDER BY B.BOOKING_DATE DESC`,
      { userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json({ success: true, bookings: result.rows });
  } catch (err) {
    console.error("❌ Error fetching bookings:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

app.post("/api/bookings", async (req, res) => {
  const { userId, eventId, plan, price, guests } = req.body;
  let conn;

  if (!userId || !eventId)
    return res.status(400).json({ success: false, message: "User ID and Event ID are required" });

  try {
    conn = await getConn();

  const result = await conn.execute(
  `INSERT INTO BOOKINGS (ID, USER_ID, EVENT_ID, BOOKING_DATE, PLAN, PRICE, GUESTS, STATUS)
   VALUES (BOOKING_SEQ.NEXTVAL, :userId, :eventId, SYSTIMESTAMP, :plan, :price, :guests, 'CONFIRMED')
   RETURNING ID INTO :newId`,
  {
    userId,
    eventId,
    plan,
    price,
    guests,
    newId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
  },
  { autoCommit: true }
);


    const bookingId = result.outBinds.newId[0];
    console.log(`🟢 Booking created successfully with ID: ${bookingId}`);

    res.json({ success: true, message: "Booking created successfully!", bookingId });
  } catch (err) {
    console.error("❌ Booking creation error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


/// ✅ 3️⃣ GET EVENT ID BY NAME (FINAL CORRECT CODE)
// =============================================================
app.get("/api/event-id/:eventName", async (req, res) => {
  const { eventName } = req.params;

  // 🚨 Matches the default seeded events
  const defaultEvents = [
    "Birthday",
    "Anniversary",
    "Meeting",
    "Graduation",
    "Concert",
    "Festivals",
    "Charity",
    "Reunion",
    "Farewell",
    "Marriage",
    "Engagement",
    "Baby Shower",
    "College Events",
    "Customized..."
  ];

  // 1️⃣ Check default events (seeded IDs start at 1000)
  const matchedDefaultIndex = defaultEvents.findIndex(
    (e) => e.toLowerCase() === eventName.toLowerCase()
  );

  if (matchedDefaultIndex !== -1) {
    const eventId = 1000 + matchedDefaultIndex;
    return res.json({ success: true, eventId });
  }

  let conn;
  try {
    conn = await getConn();

    // 2️⃣ Query DB for custom events
    const sql = `SELECT ID FROM EVENTS WHERE LOWER(NAME) = LOWER(:eventName)`;
    const result = await conn.execute(sql, { eventName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    if (result.rows.length > 0) {
      res.json({ success: true, eventId: result.rows[0].ID });
    } else {
      res.json({ success: false, message: `Event '${eventName}' not found in database.` });
    }
  } catch (err) {
    console.error("❌ Error fetching event ID:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// ✅ 4️⃣ GET BOOKINGS BY USERNAME
app.get("/api/bookings/username/:username", async (req, res) => {
  const { username } = req.params;
  if (!username) return res.status(400).json({ success: false, message: "Username required" });

  let conn;
  try {
    conn = await getConn();
    const sql = `
      SELECT b.ID AS BOOKING_ID,
             e.NAME AS EVENT_NAME,
             TO_CHAR(b.BOOKING_DATE, 'YYYY-MM-DD') AS BOOKING_DATE,
             b.PLAN,
             b.PRICE,
             b.STATUS
      FROM BOOKINGS b
      JOIN USERS u ON b.USER_ID = u.ID
      JOIN EVENTS e ON b.EVENT_ID = e.ID
      WHERE u.USERNAME = :username
      ORDER BY b.BOOKING_DATE DESC
    `;
    const result = await conn.execute(sql, { username }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    res.json({ success: true, bookings: result.rows || [] });
  } catch (err) {
    console.error("❌ Fetch bookings by username error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
  	if (conn) await conn.close();
  }
});


// ✅ 5️⃣ GET BOOKINGS BY USER ID
app.get("/api/bookings/user/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  let conn;
  try {
    conn = await getConn();
    const sql = `
      SELECT 
        B.ID AS BOOKING_ID,
        B.PLAN,
        B.PRICE,
        B.GUESTS,
        B.STATUS,
        TO_CHAR(B.BOOKING_DATE, 'YYYY-MM-DD') AS BOOKING_DATE,
        E.NAME AS EVENT_NAME,
        E.CITY,
        E.VENUE
      FROM BOOKINGS B
      JOIN EVENTS E ON B.EVENT_ID = E.ID
      WHERE B.USER_ID = :userId
      ORDER BY B.BOOKING_DATE DESC
    `;
    const result = await conn.execute(sql, { userId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    res.json({ success: true, bookings: result.rows || [] });
  } catch (err) {
    console.error("❌ Error fetching bookings:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
  	if (conn) await conn.close();
  }
});

// ==================== GET SINGLE BOOKING BY ID (FINAL FIX) ====================
console.log("🟢 /api/bookings route registered");
app.get("/api/bookings/details/:bookingId", async (req, res) => {
  const bookingId = req.params.bookingId;
  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);
    const result = await connection.execute(
      `SELECT 
          b.ID AS BOOKING_ID,
          b.BOOKING_DATE,
          b.PLAN,
          b.GUESTS,
          b.PRICE,
          b.STATUS,
          u.FULLNAME AS USER_NAME,
          u.EMAIL AS USER_EMAIL,
          e.NAME AS EVENT_NAME,
          e.EVENT_DATE
       FROM BOOKINGS b
       LEFT JOIN USERS u ON b.USER_ID = u.ID
       LEFT JOIN EVENTS e ON b.EVENT_ID = e.ID
       WHERE b.ID = :bookingId`,
      [bookingId],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: "Booking not found" });

    res.json({ success: true, booking: result.rows[0] });
  } catch (err) {
    console.error("❌ Error fetching booking:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});



// ==================== UPDATE BOOKING STATUS TO AGREED ====================
app.put("/api/bookings/:bookingId/agree", async (req, res) => {
  const bookingId = parseInt(req.params.bookingId);
  let conn;

  try {
    conn = await getConn();

    const sql = `UPDATE BOOKINGS SET STATUS = 'AGREED' WHERE ID = :bookingId`;
    await conn.execute(sql, { bookingId }, { autoCommit: true });

    console.log(`✅ Booking ${bookingId} marked as AGREED`);
    res.json({ success: true, message: "Agreement confirmed" });
  } catch (err) {
    console.error("❌ Error updating booking agreement:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});// ==================== CONFIRM PAYMENT (FINAL) ====================
app.post("/api/pay-booking", async (req, res) => {
  const { id, price, coupon } = req.body;
  let conn;

  try {
    if (!id || !price) {
      return res.status(400).json({
        success: false,
        message: "Missing booking ID or price",
      });
    }

    conn = await getConn();

    // ✅ Update payment details
    const updateSql = `
      UPDATE BOOKINGS
      SET STATUS = 'PAID',
          PRICE = :price,
          COUPON_CODE = :coupon,
          PAYMENT_DATE = SYSDATE
      WHERE ID = :id
    `;
    const result = await conn.execute(updateSql, { id, price, coupon }, { autoCommit: true });

    if (result.rowsAffected === 0) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // ✅ Fetch updated booking details
    const fetchSql = `
      SELECT 
        B.ID AS BOOKING_ID,
        B.PLAN,
        B.PRICE,
        B.STATUS,
        B.PAYMENT_DATE,
        E.NAME AS EVENT_NAME,
        E.CITY,
        E.VENUE,
        E.EVENT_DATE
      FROM BOOKINGS B
      JOIN EVENTS E ON B.EVENT_ID = E.ID
      WHERE B.ID = :id
    `;
    const fetchResult = await conn.execute(fetchSql, { id }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    console.log(`✅ Booking ${id} marked as PAID`);

    res.json({
      success: true,
      message: "Payment confirmed",
      booking: fetchResult.rows[0],
    });

  } catch (err) {
    console.error("❌ Error confirming payment:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});



// ===============================================
app.post("/api/update-booking", async (req, res) => {
  const { id, date, plan, guests } = req.body;
  let conn;

  try {
    conn = await getConn();
    const result = await conn.execute(
      `UPDATE BOOKINGS 
       SET PLAN = :plan, GUESTS = :guests, BOOKING_DATE = TO_DATE(:date, 'YYYY-MM-DD')
       WHERE ID = :id`,
      { id, date, plan, guests },
      { autoCommit: true }
    );

    if (result.rowsAffected === 0)
      return res.json({ success: false, message: "Booking not found" });

    res.json({ success: true, message: "Booking updated" });
  } catch (err) {
    console.error("❌ Error updating booking:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


// ===============================================
app.post("/api/cancel-booking", async (req, res) => {
  const { id } = req.body;
  let conn;

  try {
    conn = await getConn();
    const result = await conn.execute(
      `UPDATE BOOKINGS SET STATUS = 'CANCELLED' WHERE ID = :id`,
      { id },
      { autoCommit: true }
    );

    if (result.rowsAffected === 0)
      return res.json({ success: false, message: "Booking not found" });

    res.json({ success: true, message: "Booking cancelled" });
  } catch (err) {
    console.error("❌ Error cancelling booking:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});



//----- SAVE / GET CITY ----------
app.post("/api/save-city", async (req, res) => {
  const { city } = req.body;
  if (!city) return res.status(400).json({ success: false, message: "City name required" });

  let conn;
  try {
    conn = await getConn();
    const sql = `INSERT INTO ${schemaTable("SELECTED_CITY")} (CITY_NAME) VALUES (:city_name)`;
    await conn.execute(sql, { city_name: city }, { autoCommit: true });
    console.log("✅ City saved:", city);
    res.json({ success: true, city });
  } catch (err) {
    console.error("save-city error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

app.get("/api/get-city", async (req, res) => {
  let conn;
  try {
    conn = await getConn();
    const sql = `SELECT CITY_NAME FROM ${schemaTable("SELECTED_CITY")} ORDER BY ID DESC FETCH FIRST 1 ROWS ONLY`;
    const result = await conn.execute(sql);
    const city = (result.rows && result.rows[0]) ? (result.rows[0].CITY_NAME || result.rows[0].city_name) : null;
    res.json({ success: true, city });
  } catch (err) {
    console.error("get-city error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// ---------- SAVE / GET DATE ----------
app.post("/api/save-date", async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ success: false, message: "Date required" });

  let conn;
  try {
    conn = await getConn();
    const sql = `INSERT INTO ${schemaTable("SELECTED_DATE")} (SELECTED_DATE_VALUE) VALUES (TO_DATE(:selected_date,'YYYY-MM-DD'))`;
    await conn.execute(sql, { selected_date: date }, { autoCommit: true });
    console.log(`📅 Date saved successfully: ${date}`);
    res.json({ success: true, message: "Date saved successfully" });
  } catch (err) {
    console.error("save-date error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

app.get("/api/get-date", async (req, res) => {
  let conn;
  try {
    conn = await getConn();
    const sql = `SELECT TO_CHAR(SELECTED_DATE_VALUE,'YYYY-MM-DD') AS DATE_STR FROM ${schemaTable("SELECTED_DATE")} ORDER BY ID DESC FETCH FIRST 1 ROWS ONLY`;
    const result = await conn.execute(sql);
    const date = (result.rows && result.rows[0]) ? (result.rows[0].DATE_STR || result.rows[0].date_str) : null;
    res.json({ success: true, date });
  } catch (err) {
    console.error("get-date error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// ---------- CHAT: FETCH ----------
app.get("/api/chat/:id", async (req, res) => {
  const coordinatorId = parseInt(req.params.id);
  if (!coordinatorId) return res.status(400).json({ success: false, message: "Coordinator id required" });

  let conn;
  try {
    conn = await getConn();
    const sql = `SELECT SENDER, MESSAGE, TO_CHAR(CREATED_AT,'YYYY-MM-DD HH24:MI:SS') AS TIMESTAMP FROM ${schemaTable("CHAT_MESSAGES")} WHERE COORDINATOR_ID = :id ORDER BY CREATED_AT ASC`;
    const result = await conn.execute(sql, { id: coordinatorId });
    const messages = (result.rows || []).map(r => ({
      sender: r.SENDER || r.sender,
      message: r.MESSAGE || r.message,
      timestamp: r.TIMESTAMP || r.timestamp,
    }));
    res.json({ success: true, messages });
  } catch (err) {
    console.error("chat fetch error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// ---------- CHAT: INSERT (user + auto-reply) ----------
app.post("/api/chat/:id", async (req, res) => {
  const coordinatorId = parseInt(req.params.id);
  const { sender, message } = req.body;
  if (!coordinatorId || !sender || !message) return res.status(400).json({ success: false, message: "Invalid data" });

  let conn;
  try {
    conn = await getConn();

    const insertSql = `INSERT INTO ${schemaTable("CHAT_MESSAGES")} (COORDINATOR_ID, SENDER, MESSAGE, CREATED_AT) VALUES (:id, :sender, :message, SYSTIMESTAMP)`;
    await conn.execute(insertSql, { id: coordinatorId, sender, message }, { autoCommit: true });

    // auto-reply
    const autoReplySql = `INSERT INTO ${schemaTable("CHAT_MESSAGES")} (COORDINATOR_ID, SENDER, MESSAGE, CREATED_AT) VALUES (:id, :sender, :message, SYSTIMESTAMP)`;
    await conn.execute(autoReplySql, { id: coordinatorId, sender: "coordinator", message: "Thanks for your message! We'll get back to you soon." }, { autoCommit: true });

    res.json({ success: true });
  } catch (err) {
    console.error("chat insert error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});
// ==================== GET BOOKING BY ID (For Agreement / Checkout) ====================
app.get("/api/bookings/:id", async (req, res) => {
  const bookingId = parseInt(req.params.id);
  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(
      `
      SELECT 
        B.ID AS BOOKING_ID,
        B.PLAN,
        B.PRICE,
        B.STATUS,
        TO_CHAR(B.BOOKING_DATE, 'YYYY-MM-DD') AS BOOKING_DATE,
        U.FULLNAME AS USER_NAME,
        U.EMAIL AS USER_EMAIL,
        E.NAME AS EVENT_NAME,
        TO_CHAR(E.EVENT_DATE, 'YYYY-MM-DD') AS EVENT_DATE
      FROM BOOKINGS B
      JOIN USERS U ON B.USER_ID = U.ID
      JOIN EVENTS E ON B.EVENT_ID = E.ID
      WHERE B.ID = :id
      `,
      [bookingId],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: "Booking not found" });

    res.json({ success: true, booking: result.rows[0] });
  } catch (err) {
    console.error("❌ Error fetching booking:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});
app.get("/api/bookings/:id/receipt", async (req, res) => {
  const bookingId = parseInt(req.params.id);
  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(
      `SELECT 
          B.ID AS BOOKING_ID,
          B.USER_ID,
          B.PLAN,
          B.PRICE,
          B.STATUS,
          TO_CHAR(B.BOOKING_DATE, 'YYYY-MM-DD HH24:MI:SS') AS BOOKING_DATE,
          B.COUPON_CODE,
          E.NAME AS EVENT_NAME,
          E.CITY,
          E.VENUE,
          TO_CHAR(E.EVENT_DATE, 'YYYY-MM-DD HH24:MI:SS') AS EVENT_DATE,
          U.FULLNAME,
          U.EMAIL
       FROM BOOKINGS B
       JOIN USERS U ON B.USER_ID = U.ID
       JOIN EVENTS E ON B.EVENT_ID = E.ID
       WHERE B.ID = :id`,
      [bookingId],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: "Booking not found" });

    const b = result.rows[0];
    const doc = new jsPDF();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Event Booking Receipt", 65, 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`Booking ID: ${b.BOOKING_ID}`, 20, 40);
    doc.text(`Name: ${b.FULLNAME}`, 20, 50);
    doc.text(`Email: ${b.EMAIL}`, 20, 60);
    doc.text(`Event: ${b.EVENT_NAME}`, 20, 70);
    doc.text(`Venue: ${b.VENUE}, ${b.CITY}`, 20, 80);
    doc.text(`Event Date: ${b.EVENT_DATE}`, 20, 90);
    doc.text(`Booking Date: ${b.BOOKING_DATE}`, 20, 100);
    doc.text(`Plan: ${b.PLAN}`, 20, 110);
    doc.text(`Status: ${b.STATUS}`, 20, 120);
    if (b.COUPON_CODE) doc.text(`Coupon: ${b.COUPON_CODE}`, 20, 130);
    doc.text(`Total: ₹${parseFloat(b.PRICE).toLocaleString()}`, 20, 140);

    const pdfBytes = doc.output();
    res.contentType("application/pdf");
    res.send(Buffer.from(pdfBytes, "binary"));
  } catch (err) {
    console.error("❌ Error generating receipt:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

// ====================== ADMIN ROUTES ======================
app.get("/api/admin/overview", async (req, res) => {
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);

    // ✅ Total Users
    const users = await connection.execute(
      `SELECT COUNT(*) AS TOTAL_USERS FROM USERS`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    // ✅ Total Events
    const events = await connection.execute(
      `SELECT COUNT(*) AS TOTAL_EVENTS FROM EVENTS`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    // ✅ Total Bookings
    const bookings = await connection.execute(
      `SELECT COUNT(*) AS TOTAL_BOOKINGS FROM BOOKINGS`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    // ✅ Total Revenue (Confirmed only)
    const revenue = await connection.execute(
      `SELECT NVL(SUM(PRICE), 0) AS TOTAL_REVENUE
       FROM BOOKINGS
       WHERE STATUS = 'CONFIRMED'`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    // ✅ Revenue by Month (for chart)
    const revenueByMonth = await connection.execute(
      `SELECT 
         TO_CHAR(BOOKING_DATE, 'Mon') AS MONTH,
         NVL(SUM(PRICE), 0) AS TOTAL
       FROM BOOKINGS
       WHERE STATUS = 'CONFIRMED'
       GROUP BY TO_CHAR(BOOKING_DATE, 'Mon'), TO_NUMBER(TO_CHAR(BOOKING_DATE, 'MM'))
       ORDER BY TO_NUMBER(TO_CHAR(BOOKING_DATE, 'MM'))`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    // ✅ Plans distribution
    const plans = await connection.execute(
      `SELECT PLAN, COUNT(*) AS CNT FROM BOOKINGS GROUP BY PLAN`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    // ✅ Events per city
    const cities = await connection.execute(
      `SELECT CITY, COUNT(*) AS CNT FROM EVENTS GROUP BY CITY`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json({
      stats: {
        totalUsers: users.rows[0].TOTAL_USERS,
        totalEvents: events.rows[0].TOTAL_EVENTS,
        totalBookings: bookings.rows[0].TOTAL_BOOKINGS,
        totalRevenue: revenue.rows[0].TOTAL_REVENUE
      },
      charts: {
        revenue: {
          labels: revenueByMonth.rows.map(r => r.MONTH),
          values: revenueByMonth.rows.map(r => r.TOTAL)
        },
        plans: {
          labels: plans.rows.map(r => r.PLAN || "N/A"),
          values: plans.rows.map(r => r.CNT)
        },
        cities: {
          labels: cities.rows.map(r => r.CITY || "Unknown"),
          values: cities.rows.map(r => r.CNT)
        }
      }
    });

  } catch (err) {
    console.error("Error fetching overview:", err);
    res.status(500).json({ error: "Failed to fetch overview data" });
  } finally {
    if (connection) await connection.close();
  }
});



/**
 * ✅ Admin: Manage Users
 */
app.get("/api/admin/users", async (req, res) => {
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    const result = await connection.execute(
      `SELECT ID, USERNAME, FULLNAME, EMAIL FROM USERS ORDER BY ID`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json({ success: true, users: result.rows });
  } catch (err) {
    console.error("❌ Admin users error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

app.put("/api/admin/users/:id", async (req, res) => {
  const { id } = req.params;
  const { FULLNAME, EMAIL } = req.body;
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    await connection.execute(
      `UPDATE USERS SET FULLNAME = :FULLNAME, EMAIL = :EMAIL WHERE ID = :id`,
      { FULLNAME, EMAIL, id },
      { autoCommit: true }
    );
    res.json({ success: true, message: "User updated successfully." });
  } catch (err) {
    console.error("❌ Admin update user error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

app.delete("/api/admin/users/:id", async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    await connection.execute(`DELETE FROM USERS WHERE ID = :id`, [id], { autoCommit: true });
    res.json({ success: true, message: "User deleted successfully." });
  } catch (err) {
    console.error("❌ Admin delete user error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

/**
 * ✅ Admin: Manage Events
 */
app.get("/api/admin/events", async (req, res) => {
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    const result = await connection.execute(
      `SELECT 
         ID, NAME, CITY, VENUE, 
         TO_CHAR(EVENT_DATE, 'YYYY-MM-DD HH24:MI:SS') AS EVENT_DATE,
         CREATED_BY
       FROM EVENTS
       ORDER BY EVENT_DATE DESC`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json({ success: true, events: result.rows });
  } catch (err) {
    console.error("❌ Admin events error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

app.post("/api/admin/events", async (req, res) => {
  const { name, city, venue, event_date, created_by } = req.body;
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    await connection.execute(
      `INSERT INTO EVENTS (NAME, CITY, VENUE, EVENT_DATE, CREATED_BY)
       VALUES (:name, :city, :venue, TO_DATE(:event_date, 'YYYY-MM-DD'), :created_by)`,
      { name, city, venue, event_date, created_by: created_by || "admin" },
      { autoCommit: true }
    );
    res.json({ success: true, message: "Event added successfully." });
  } catch (err) {
    console.error("❌ Admin add event error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

app.delete("/api/admin/events/:id", async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    await connection.execute(`DELETE FROM EVENTS WHERE ID = :id`, [id], { autoCommit: true });
    res.json({ success: true, message: "Event deleted successfully." });
  } catch (err) {
    console.error("❌ Admin delete event error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

/**
 * ✅ Admin: Manage Coupons
 */
app.get("/api/admin/coupons", async (req, res) => {
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    const result = await connection.execute(
      `SELECT 
         ID, CODE, DISCOUNT_PERCENT, USAGE_LIMIT,
         TO_CHAR(EXPIRES_AT, 'YYYY-MM-DD') AS EXPIRES_AT,
         CREATED_BY,
         TO_CHAR(CREATED_AT, 'YYYY-MM-DD HH24:MI:SS') AS CREATED_AT
       FROM COUPONS
       ORDER BY CREATED_AT DESC`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json({ success: true, coupons: result.rows });
  } catch (err) {
    console.error("❌ Admin coupons error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

app.post("/api/admin/coupons", async (req, res) => {
  const { code, discountPercent, usageLimit, expiresAt, createdBy } = req.body;
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    await connection.execute(
      `INSERT INTO COUPONS (CODE, DISCOUNT_PERCENT, USAGE_LIMIT, EXPIRES_AT, CREATED_BY, CREATED_AT)
       VALUES (:code, :discountPercent, :usageLimit, TO_DATE(:expiresAt, 'YYYY-MM-DD'), :createdBy, SYSTIMESTAMP)`,
      { code, discountPercent, usageLimit, expiresAt, createdBy: createdBy || "admin" },
      { autoCommit: true }
    );
    res.json({ success: true, message: "Coupon created successfully." });
  } catch (err) {
    console.error("❌ Admin create coupon error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

app.delete("/api/admin/coupons/:id", async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    await connection.execute(`DELETE FROM COUPONS WHERE ID = :id`, [id], { autoCommit: true });
    res.json({ success: true, message: "Coupon deleted successfully." });
  } catch (err) {
    console.error("❌ Admin delete coupon error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});


app.get("/api/admin/feedback", async (req, res) => {
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);

    const sql = `
      SELECT 
        F.ID              AS FEEDBACK_ID,
        F.USER_ID,
        COALESCE(U.USERNAME, 'Anonymous') AS USERNAME,
        TO_CHAR(F.MESSAGE) AS MESSAGE,       -- 👈 forces plain string
        COALESCE(F.STATUS, 'NEW') AS STATUS,
        TO_CHAR(F.CREATED_AT, 'YYYY-MM-DD HH24:MI:SS') AS CREATED_AT
      FROM FEEDBACK F
      LEFT JOIN USERS U ON F.USER_ID = U.ID
      ORDER BY F.CREATED_AT DESC
    `;

    const result = await connection.execute(sql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    // every row is already a plain object of primitives
    const rows = result.rows.map(r => ({
      FEEDBACK_ID: r.FEEDBACK_ID,
      USER_ID: r.USER_ID,
      USERNAME: r.USERNAME,
      MESSAGE: r.MESSAGE,
      STATUS: r.STATUS,
      CREATED_AT: r.CREATED_AT,
    }));

    res.json({ success: true, feedback: rows });
  } catch (err) {
    console.error("❌ Admin feedback error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) try { await connection.close(); } catch {}
  }
});


/* ====================================
   🟣 POST REPLY TO FEEDBACK (CLOB SAFE)
   ==================================== */
app.post("/api/admin/feedback/:id/reply", async (req, res) => {
  const { id } = req.params;
  const { reply } = req.body;

  if (!id || !reply) {
    return res.status(400).json({ success: false, message: "Feedback ID and reply are required." });
  }

  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    // Oracle-safe concatenation using CLOB handling
    const sql = `
      UPDATE FEEDBACK
      SET STATUS = 'REPLIED',
          MESSAGE = CASE
            WHEN MESSAGE IS NULL THEN TO_CLOB('--- Reply (' || TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI') || ') ---' || CHR(10) || :reply)
            ELSE MESSAGE || CHR(10) || TO_CLOB('--- Reply (' || TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI') || ') ---' || CHR(10) || :reply)
          END
      WHERE ID = :id
    `;

    const result = await connection.execute(sql, { reply, id }, { autoCommit: true });

    if (result.rowsAffected === 0) {
      return res.status(404).json({ success: false, message: "Feedback not found." });
    }

    console.log(`✅ Admin replied to feedback #${id}`);
    res.json({ success: true, message: "Reply added successfully." });

  } catch (err) {
    console.error("❌ Admin feedback reply error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (e) { console.warn("⚠️ close error:", e); }
    }
  }
});

/**
 * ✅ Admin: Export Users as CSV
 */
const { Parser } = require("json2csv");
app.get("/api/admin/export/users.csv", async (req, res) => {
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    const result = await connection.execute(`SELECT ID, USERNAME, FULLNAME, EMAIL FROM USERS`);
    const data = result.rows.map(r => ({
      ID: r[0],
      USERNAME: r[1],
      FULLNAME: r[2],
      EMAIL: r[3],
    }));
    const csv = new Parser().parse(data);
    res.header("Content-Type", "text/csv");
    res.attachment("users.csv");
    res.send(csv);
  } catch (err) {
    console.error("❌ Export users error:", err);
    res.status(500).send("Export failed.");
  } finally {
    if (connection) await connection.close();
  }
});

/**
 * ✅ Admin: Manage Bookings
 */
app.get("/api/admin/bookings", async (req, res) => {
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    const result = await connection.execute(
      `SELECT 
         B.ID, U.USERNAME, E.NAME AS EVENT_NAME,
         TO_CHAR(B.BOOKING_DATE, 'YYYY-MM-DD') AS BOOKING_DATE,
         B.PRICE, B.STATUS
       FROM BOOKINGS B
       JOIN USERS U ON B.USER_ID = U.ID
       JOIN EVENTS E ON B.EVENT_ID = E.ID
       ORDER BY B.BOOKING_DATE DESC`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json({ success: true, bookings: result.rows });
  } catch (err) {
    console.error("❌ Admin fetch bookings error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

app.put("/api/admin/bookings/:id/approve", async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    await connection.execute(
      `UPDATE BOOKINGS SET STATUS = 'APPROVED' WHERE ID = :id`,
      { id },
      { autoCommit: true }
    );
    res.json({ success: true, message: "Booking approved successfully." });
  } catch (err) {
    console.error("❌ Admin approve booking error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

app.put("/api/admin/bookings/:id/cancel", async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    await connection.execute(
      `UPDATE BOOKINGS SET STATUS = 'CANCELLED' WHERE ID = :id`,
      { id },
      { autoCommit: true }
    );
    res.json({ success: true, message: "Booking cancelled successfully." });
  } catch (err) {
    console.error("❌ Admin cancel booking error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

app.get("/api/admin/bookings/status/:status", async (req, res) => {
  const status = req.params.status.toUpperCase();
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    const result = await connection.execute(
      `SELECT 
         B.ID, U.USERNAME, E.NAME AS EVENT_NAME,
         TO_CHAR(B.BOOKING_DATE, 'YYYY-MM-DD') AS BOOKING_DATE,
         B.PRICE, B.STATUS
       FROM BOOKINGS B
       JOIN USERS U ON B.USER_ID = U.ID
       JOIN EVENTS E ON B.EVENT_ID = E.ID
       WHERE B.STATUS = :status
       ORDER BY B.BOOKING_DATE DESC`,
      { status },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json({ success: true, bookings: result.rows });
  } catch (err) {
    console.error("❌ Admin filter bookings error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

// ---------- STATIC / ROOT ----------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend", "Project.html"));
});

app.get("/debug", (req, res) => {
  const htmlPath = path.join(__dirname, "../frontend", "Project.html");
  res.send({
    htmlPath,
    exists: fs.existsSync(htmlPath),
    filesInFrontend: fs.existsSync(path.join(__dirname, "../frontend")) ? fs.readdirSync(path.join(__dirname, "../frontend")) : [],
  });
});
app.use(express.static(path.join(__dirname, "frontend")));

// ---------- ERROR HANDLER ----------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, message: "Internal Server Error" });
});
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ---------- START ----------
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));

