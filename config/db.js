const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'users.db');

class Database {
  constructor() {
    this.db = null;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('Error opening database:', err.message);
          reject(err);
        } else {
          console.log('Connected to SQLite database.');
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    return new Promise((resolve, reject) => {
      const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      this.db.run(createUsersTable, (err) => {
        if (err) {
          console.error('Error creating users table:', err.message);
          reject(err);
        } else {
          console.log('Users table ready.');
          resolve();
        }
      });
    });
  }

  async createUser(userData) {
    return new Promise((resolve, reject) => {
      const { id, name, email, passwordHash } = userData;
      const stmt = this.db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)');
      
      stmt.run([id, name, email, passwordHash], function(err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            reject(new Error('Email already registered'));
          } else {
            reject(err);
          }
        } else {
          resolve({ id, name, email });
        }
      });
      
      stmt.finalize();
    });
  }

  async getUserByEmail(email) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?');
      
      stmt.get([email], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
      
      stmt.finalize();
    });
  }

  async getUserById(id) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare('SELECT id, name, email FROM users WHERE id = ?');
      
      stmt.get([id], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
      
      stmt.finalize();
    });
  }

  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err.message);
        } else {
          console.log('Database connection closed.');
        }
      });
    }
  }
}

module.exports = new Database();
