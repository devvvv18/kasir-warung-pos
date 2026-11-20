const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// Pastikan direktori database tersedia
const dbDir = path.join(__dirname);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'kasir.db');

// Inisialisasi koneksi database SQLite
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error saat menghubungkan ke database SQLite:', err.message);
  } else {
    console.log(`Terhubung ke database SQLite di: ${dbPath}`);
  }
});

  /**
   * Eksekusi query INSERT / UPDATE / DELETE dengan Promise
   * @param {string} sql
   * @param {any[]} params
   * @returns {Promise<{ lastID: number, changes: number }>}
   */
  function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) return reject(err);
          resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
  }

    /**
     * Ambil 1 baris data dengan Promise
     * @param {string} sql
     * @param {any[]} params
     * @returns {Promise<any>}
     */
    function getAsync(sql, params = []) {
      return new Promise((resolve, reject) => {
          db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
          });
        });
    }

      /**
       * Ambil banyak baris data dengan Promise
       * @param {string} sql
       * @param {any[]} params
       * @returns {Promise<any[]>}
       */
      function allAsync(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
              if (err) return reject(err);
              resolve(rows);
            });
          });
      }

        /**
         * Eksekusi skrip SQL jamak
         * @param {string} sql
         * @returns {Promise<void>}
         */
        function execAsync(sql) {
          return new Promise((resolve, reject) => {
              db.exec(sql, (err) => {
                if (err) return reject(err);
                resolve();
              });
            });
        }

        // Sematkan helper ke instance db
        db.runAsync = runAsync;
        db.getAsync = getAsync;
        db.allAsync = allAsync;
        db.execAsync = execAsync;

        // Inisialisasi skema tabel & seeder awal
        async function initDatabase() {
          try {
            // Aktifkan foreign keys
            await db.runAsync('PRAGMA foreign_keys = ON;');

            // 1. Tabel Settings
            await db.runAsync(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY,
        store_name TEXT DEFAULT 'TOKO SERBA ADA',
        store_address TEXT DEFAULT 'Jl. Raya Utama No. 1',
        store_phone TEXT DEFAULT '0812-3456-7890',
        receipt_footer TEXT DEFAULT 'Terima kasih telah berbelanja!',
        paper_size TEXT DEFAULT '58mm'
      )
    `);

            // Inisialisasi baris pengaturan default jika belum ada
            const existingSetting = await db.getAsync('SELECT * FROM settings WHERE id = 1');
            if (!existingSetting) {
              await db.runAsync(`
        INSERT INTO settings (id, store_name, store_address, store_phone, receipt_footer, paper_size)
        VALUES (1, 'TOKO SERBA ADA', 'Jl. Raya Utama No. 1', '0812-3456-7890', 'Terima kasih telah berbelanja!', '58mm')
      `);
              console.log('Data default pengaturan toko berhasil dibuat.');
            }

            // 2. Tabel Products
            await db.runAsync(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT UNIQUE,
        name TEXT NOT NULL,
        category TEXT,
        buy_price INTEGER NOT NULL,
        sell_price INTEGER NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

            // 3. Tabel Transactions
            await db.runAsync(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT UNIQUE,
        customer_name TEXT DEFAULT 'Pelanggan Umum',
        subtotal INTEGER,
        discount INTEGER DEFAULT 0,
        grand_total INTEGER,
        cash_received INTEGER,
        change_amount INTEGER,
        payment_method TEXT DEFAULT 'Tunai',
        status TEXT DEFAULT 'Lunas',
        paid_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Auto-migrasi kolom kasbon / bayar nanti jika tabel sudah ada
    try {
      await db.runAsync("ALTER TABLE transactions ADD COLUMN customer_name TEXT DEFAULT 'Pelanggan Umum';");
    } catch (e) {}
    try {
      await db.runAsync("ALTER TABLE transactions ADD COLUMN status TEXT DEFAULT 'Lunas';");
    } catch (e) {}
    try {
      await db.runAsync("ALTER TABLE transactions ADD COLUMN paid_at DATETIME;");
    } catch (e) {}

            // 4. Tabel Transaction Items
            await db.runAsync(`
      CREATE TABLE IF NOT EXISTS transaction_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id INTEGER,
        product_id INTEGER,
        product_name TEXT,
        buy_price INTEGER,
        sell_price INTEGER,
        qty INTEGER,
        subtotal INTEGER,
        FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE
      )
    `);

            // Seed dummy products jika tabel products masih kosong
            const productCountRow = await db.getAsync('SELECT COUNT(*) AS total FROM products');
            if (productCountRow && productCountRow.total === 0) {
              const dummyProducts = [
                {
                  sku: 'PRD-001',
                  name: 'Minyak Goreng Sawit 2L',
                  category: 'Sembako',
                  buy_price: 28000,
                  sell_price: 34000,
                  stock: 25
                },
                {
                  sku: 'PRD-002',
                  name: 'Beras Pandan Wangi 5kg',
                  category: 'Sembako',
                  buy_price: 68000,
                  sell_price: 76000,
                  stock: 15
                },
                {
                  sku: 'PRD-003',
                  name: 'Gula Pasir Kristal Putih 1kg',
                  category: 'Sembako',
                  buy_price: 14500,
                  sell_price: 17500,
                  stock: 30
                },
                {
                  sku: 'PRD-004',
                  name: 'Kopi Bubuk Robusta 200g',
                  category: 'Minuman',
                  buy_price: 12000,
                  sell_price: 16000,
          stock: 12
                },
                {
                  sku: 'PRD-005',
                  name: 'Teh Celup Melati 25 Kantong',
                  category: 'Minuman',
                  buy_price: 6000,
                  sell_price: 8500,
                  stock: 20
                }
              ];

              for (const p of dummyProducts) {
                await db.runAsync(
                  `INSERT INTO products (sku, name, category, buy_price, sell_price, stock)
           VALUES (?, ?, ?, ?, ?, ?)`,
                  [p.sku, p.name, p.category, p.buy_price, p.sell_price, p.stock]
                );
              }
              console.log('5 Data dummy produk awal berhasil di-seed.');
            }

            console.log('Inisialisasi skema database SQLite selesai.');
          } catch (error) {
            console.error('Error saat inisialisasi database:', error);
          }
        }

        initDatabase();

        module.exports = db;
