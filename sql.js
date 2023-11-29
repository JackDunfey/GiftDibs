const db = require("better-sqlite3");
const path = require("path");

const database = new db(path.join(__dirname, "databases/database.sqlite"));

SQL = `DELETE FROM gifts;`;
database.exec(SQL);