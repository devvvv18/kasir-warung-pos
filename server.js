const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const db = require('./database/db.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Format tanggal lokal untuk query SQLite
function buildDateFilter(start, end, column = 'created_at') {
  let query = '';
  const params = [];

  if (start && end) {
    query = ` AND date(datetime(${column}, 'localtime')) BETWEEN date(?) AND date(?)`;
    params.push(start, end);
  } else if (start) {
    query = ` AND date(datetime(${column}, 'localtime')) >= date(?)`;
    params.push(start);
  } else if (end) {
    query = ` AND date(datetime(${column}, 'localtime')) <= date(?)`;
    params.push(end);
  }

  return { query, params };
}

// ==========================================
// 1. API SETTINGS (Pengaturan Toko)
// ==========================================
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await db.getAsync('SELECT * FROM settings WHERE id = 1');
    res.json(settings || {
      id: 1,
      store_name: 'TOKO SERBA ADA',
      store_address: 'Jl. Raya Utama No. 1',
      store_phone: '0812-3456-7890',
      receipt_footer: 'Terima kasih telah berbelanja!',
      paper_size: '58mm'
    });
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: 'Gagal mengambil data pengaturan toko' });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const { store_name, store_address, store_phone, receipt_footer, paper_size } = req.body;

    await db.runAsync(
      `UPDATE settings SET 
        store_name = ?, 
        store_address = ?, 
        store_phone = ?, 
        receipt_footer = ?, 
        paper_size = ? 
       WHERE id = 1`,
      [
        store_name || 'TOKO SERBA ADA',
        store_address || '',
        store_phone || '',
        receipt_footer || 'Terima kasih telah berbelanja!',
        paper_size === '80mm' ? '80mm' : '58mm'
      ]
    );

    const updated = await db.getAsync('SELECT * FROM settings WHERE id = 1');
    res.json({ message: 'Pengaturan toko berhasil diperbarui', settings: updated });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: 'Gagal menyimpan pengaturan toko' });
  }
});

// ==========================================
// 2. API PRODUCTS (Manajemen Barang)
// ==========================================

// Ringkasan Aset Produk
app.get('/api/products/summary', async (req, res) => {
  try {
    const summary = await db.getAsync(`
      SELECT 
        COUNT(*) AS total_products,
        COALESCE(SUM(stock), 0) AS total_units,
        COALESCE(SUM(stock * buy_price), 0) AS total_asset_value,
        COALESCE(SUM(CASE WHEN stock <= 5 THEN 1 ELSE 0 END), 0) AS low_stock_count
      FROM products
    `);
    res.json(summary);
  } catch (err) {
    console.error('Error fetching product summary:', err);
    res.status(500).json({ error: 'Gagal mengambil ringkasan produk' });
  }
});

// Kategori unik
app.get('/api/products/categories', async (req, res) => {
  try {
    const categories = await db.allAsync(`
      SELECT DISTINCT category FROM products 
      WHERE category IS NOT NULL AND TRIM(category) != '' 
      ORDER BY category ASC
    `);
    res.json(categories.map(c => c.category));
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Gagal mengambil kategori' });
  }
});

// Daftar Semua Produk (dengan filter pencarian, kategori, dan stok menipis)
app.get('/api/products', async (req, res) => {
  try {
    const { search, category, low_stock } = req.query;
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (search && search.trim() !== '') {
      sql += ' AND (name LIKE ? OR sku LIKE ?)';
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (category && category.trim() !== '' && category !== 'Semua') {
      sql += ' AND category = ?';
      params.push(category.trim());
    }

    if (low_stock === 'true') {
      sql += ' AND stock <= 5';
    }

    sql += ' ORDER BY name ASC';

    const products = await db.allAsync(sql, params);
    res.json(products);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Gagal mengambil daftar produk' });
  }
});

// Detail 1 Produk
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await db.getAsync('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!product) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    res.json(product);
  } catch (err) {
    console.error('Error fetching product detail:', err);
    res.status(500).json({ error: 'Gagal mengambil detail produk' });
  }
});

// Tambah Produk Baru
app.post('/api/products', async (req, res) => {
  try {
    const { sku, name, category, buy_price, sell_price, stock } = req.body;

    if (!sku || !name || buy_price === undefined || sell_price === undefined) {
      return res.status(400).json({ error: 'SKU, Nama, Harga Modal, dan Harga Jual wajib diisi' });
    }

    // Periksa duplikasi SKU
    const existingSku = await db.getAsync('SELECT id FROM products WHERE sku = ?', [sku.trim()]);
    if (existingSku) {
      return res.status(400).json({ error: `SKU '${sku}' sudah digunakan oleh produk lain` });
    }

    const cleanBuyPrice = Math.max(0, parseInt(buy_price, 10) || 0);
    const cleanSellPrice = Math.max(0, parseInt(sell_price, 10) || 0);
    const cleanStock = Math.max(0, parseInt(stock, 10) || 0);

    const result = await db.runAsync(
      `INSERT INTO products (sku, name, category, buy_price, sell_price, stock)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sku.trim(), name.trim(), (category || '').trim(), cleanBuyPrice, cleanSellPrice, cleanStock]
    );

    const newProduct = await db.getAsync('SELECT * FROM products WHERE id = ?', [result.lastID]);
    res.status(201).json({ message: 'Produk berhasil ditambahkan', product: newProduct });
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(500).json({ error: 'Gagal menambahkan produk' });
  }
});

// Update Produk
app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { sku, name, category, buy_price, sell_price, stock } = req.body;

    const existingProduct = await db.getAsync('SELECT * FROM products WHERE id = ?', [id]);
    if (!existingProduct) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }

    // Periksa keunikan SKU (selain produk ini sendiri)
    const duplicateSku = await db.getAsync('SELECT id FROM products WHERE sku = ? AND id != ?', [sku.trim(), id]);
    if (duplicateSku) {
      return res.status(400).json({ error: `SKU '${sku}' sudah digunakan oleh produk lain` });
    }

    const cleanBuyPrice = Math.max(0, parseInt(buy_price, 10) || 0);
    const cleanSellPrice = Math.max(0, parseInt(sell_price, 10) || 0);
    const cleanStock = Math.max(0, parseInt(stock, 10) || 0);

    await db.runAsync(
      `UPDATE products SET 
        sku = ?, 
        name = ?, 
        category = ?, 
        buy_price = ?, 
        sell_price = ?, 
        stock = ? 
       WHERE id = ?`,
      [sku.trim(), name.trim(), (category || '').trim(), cleanBuyPrice, cleanSellPrice, cleanStock, id]
    );

    const updated = await db.getAsync('SELECT * FROM products WHERE id = ?', [id]);
    res.json({ message: 'Produk berhasil diperbarui', product: updated });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Gagal memperbarui produk' });
  }
});

// Hapus Produk
app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.getAsync('SELECT * FROM products WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }

    await db.runAsync('DELETE FROM products WHERE id = ?', [id]);
    res.json({ message: `Produk '${existing.name}' berhasil dihapus` });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ error: 'Gagal menghapus produk' });
  }
});

// ==========================================
// 3. API TRANSACTIONS (POS & Kasir)
// ==========================================

// Proses Checkout & Simpan Transaksi (Atomic SQLite Transaction)
app.post('/api/transactions', async (req, res) => {
  const { items, discount, cash_received, payment_method, customer_name, payment_status } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Keranjang belanja tidak boleh kosong' });
  }

  const cleanDiscount = Math.max(0, parseInt(discount, 10) || 0);
  const cleanCustomer = (customer_name || 'Pelanggan Umum').trim();
  const isPayLater = payment_status === 'Belum Lunas';
  const cleanPaymentMethod = isPayLater ? 'Bayar Nanti (Kasbon)' : (payment_method || 'Tunai');
  const txStatus = isPayLater ? 'Belum Lunas' : 'Lunas';

  try {
    // Mulai transaksi SQLite
    await db.runAsync('BEGIN TRANSACTION;');

    // 1. Validasi stok semua item terlebih dahulu
    const validatedItems = [];
    let calculatedSubtotal = 0;

    for (const item of items) {
      const product = await db.getAsync('SELECT * FROM products WHERE id = ?', [item.product_id]);
      if (!product) {
        await db.runAsync('ROLLBACK;');
        return res.status(400).json({ error: `Produk dengan ID ${item.product_id} tidak ditemukan` });
      }

      const requestedQty = parseInt(item.qty, 10) || 0;
      if (requestedQty <= 0) {
        await db.runAsync('ROLLBACK;');
        return res.status(400).json({ error: `Jumlah barang untuk '${product.name}' harus lebih dari 0` });
      }

      if (product.stock < requestedQty) {
        await db.runAsync('ROLLBACK;');
        return res.status(400).json({
          error: `Stok tidak mencukupi untuk '${product.name}'. Stok tersedia: ${product.stock}, diminta: ${requestedQty}`
        });
      }

      const itemSubtotal = product.sell_price * requestedQty;
      calculatedSubtotal += itemSubtotal;

      validatedItems.push({
        product_id: product.id,
        product_name: product.name,
        buy_price: product.buy_price,
        sell_price: product.sell_price,
        qty: requestedQty,
        subtotal: itemSubtotal
      });
    }

    const grand_total = Math.max(0, calculatedSubtotal - cleanDiscount);

    let cleanCash = Math.max(0, parseInt(cash_received, 10) || 0);
    let change_amount = 0;

    // Jika bayar tunai biasa, pastikan uang cukup
    if (!isPayLater) {
      if (cleanCash < grand_total) {
        await db.runAsync('ROLLBACK;');
        return res.status(400).json({
          error: `Uang tunai tidak mencukupi! Total: Rp ${grand_total.toLocaleString('id-ID')}, Diterima: Rp ${cleanCash.toLocaleString('id-ID')}`
        });
      }
      change_amount = cleanCash - grand_total;
    } else {
      // Jika kasbon / bayar nanti, uang tunai bisa 0 atau uang muka
      change_amount = 0;
    }

    // 2. Generate Nomor Invoice unik format: INV-YYYYMMDD-XXXX
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yyyy}${mm}${dd}`;

    const todayCountRow = await db.getAsync(
      "SELECT COUNT(*) AS count FROM transactions WHERE invoice_number LIKE ?",
      [`INV-${datePrefix}-%`]
    );
    const nextSeq = String((todayCountRow ? todayCountRow.count : 0) + 1).padStart(4, '0');
    const invoice_number = `INV-${datePrefix}-${nextSeq}`;

    const pad = n => String(n).padStart(2, '0');
    const localNow = `${yyyy}-${mm}-${dd} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // 3. Simpan ke tabel transactions (Waktu Real-Time Lokal)
    const transResult = await db.runAsync(
      `INSERT INTO transactions (
        invoice_number, customer_name, subtotal, discount, grand_total, cash_received, change_amount, payment_method, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [invoice_number, cleanCustomer, calculatedSubtotal, cleanDiscount, grand_total, cleanCash, change_amount, cleanPaymentMethod, txStatus, localNow]
    );

    const transactionId = transResult.lastID;

    // 4. Simpan setiap item ke transaction_items & kurangi stok produk secara atomik
    for (const item of validatedItems) {
      await db.runAsync(
        `INSERT INTO transaction_items (
          transaction_id, product_id, product_name, buy_price, sell_price, qty, subtotal
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [transactionId, item.product_id, item.product_name, item.buy_price, item.sell_price, item.qty, item.subtotal]
      );

      await db.runAsync(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [item.qty, item.product_id]
      );
    }

    // Selesaikan transaksi SQLite
    await db.runAsync('COMMIT;');

    // Ambil data transaksi lengkap beserta pengaturan toko untuk struk
    const createdTransaction = await db.getAsync('SELECT * FROM transactions WHERE id = ?', [transactionId]);
    const transactionItems = await db.allAsync('SELECT * FROM transaction_items WHERE transaction_id = ?', [transactionId]);
    const settings = await db.getAsync('SELECT * FROM settings WHERE id = 1');

    res.status(201).json({
      message: isPayLater ? `Tagihan kasbon atas nama '${cleanCustomer}' berhasil disimpan!` : 'Transaksi berhasil disimpan',
      transaction: createdTransaction,
      items: transactionItems,
      settings: settings
    });
  } catch (err) {
    try {
      await db.runAsync('ROLLBACK;');
    } catch (rbErr) {
      console.error('Error saat rollback:', rbErr);
    }
    console.error('Error processing transaction:', err);
    res.status(500).json({ error: 'Gagal memproses transaksi kasir' });
  }
});

// Daftar Transaksi Kasbon (Belum Lunas / Bayar Nanti)
app.get('/api/debts', async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `
      SELECT 
        t.*,
        COALESCE(SUM(ti.qty), 0) AS total_items
      FROM transactions t
      LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
      WHERE t.status = 'Belum Lunas'
    `;
    const params = [];

    if (search && search.trim() !== '') {
      sql += ' AND (t.customer_name LIKE ? OR t.invoice_number LIKE ?)';
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    sql += ' GROUP BY t.id ORDER BY t.id DESC';

    const debts = await db.allAsync(sql, params);

    const summary = await db.getAsync(`
      SELECT 
        COUNT(*) AS total_unpaid_count,
        COALESCE(SUM(grand_total), 0) AS total_unpaid_amount
      FROM transactions
      WHERE status = 'Belum Lunas'
    `);

    res.json({
      debts,
      summary: summary || { total_unpaid_count: 0, total_unpaid_amount: 0 }
    });
  } catch (err) {
    console.error('Error fetching debts:', err);
    res.status(500).json({ error: 'Gagal mengambil data kasbon' });
  }
});

// Pelunasan Transaksi Kasbon (Bayar Nanti -> LUNAS)
app.put('/api/transactions/:id/pay', async (req, res) => {
  try {
    const { id } = req.params;
    const { cash_received } = req.body;

    const tx = await db.getAsync('SELECT * FROM transactions WHERE id = ?', [id]);
    if (!tx) {
      return res.status(404).json({ error: 'Data transaksi kasbon tidak ditemukan' });
    }

    const cleanCash = Math.max(0, parseInt(cash_received, 10) || 0);
    if (cleanCash < tx.grand_total) {
      return res.status(400).json({
        error: `Uang tunai pelunasan kurang! Tagihan: Rp ${tx.grand_total.toLocaleString('id-ID')}, Diterima: Rp ${cleanCash.toLocaleString('id-ID')}`
      });
    }

    const change_amount = cleanCash - tx.grand_total;

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const localNow = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    await db.runAsync(
      `UPDATE transactions SET 
        status = 'Lunas',
        cash_received = ?,
        change_amount = ?,
        payment_method = 'Tunai (Pelunasan)',
        paid_at = ?
       WHERE id = ?`,
      [cleanCash, change_amount, localNow, id]
    );

    const updatedTx = await db.getAsync('SELECT * FROM transactions WHERE id = ?', [id]);
    const items = await db.allAsync('SELECT * FROM transaction_items WHERE transaction_id = ?', [id]);
    const settings = await db.getAsync('SELECT * FROM settings WHERE id = 1');

    res.json({
      message: `Hutang / Kasbon '${tx.customer_name}' sebesar Rp ${tx.grand_total.toLocaleString('id-ID')} telah LUNAS!`,
      transaction: updatedTx,
      items: items,
      settings: settings
    });
  } catch (err) {
    console.error('Error settling debt:', err);
    res.status(500).json({ error: 'Gagal memproses pelunasan kasbon' });
  }
});

// Daftar Riwayat Transaksi (dengan filter tanggal & pencarian invoice)
app.get('/api/transactions', async (req, res) => {
  try {
    const { start, end, search, status } = req.query;
    let sql = `
      SELECT 
        t.*,
        COALESCE(SUM(ti.qty), 0) AS total_items
      FROM transactions t
      LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
      WHERE 1=1
    `;
    const params = [];

    if (search && search.trim() !== '') {
      sql += ' AND (t.invoice_number LIKE ? OR t.customer_name LIKE ?)';
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (status && status !== 'Semua') {
      sql += ' AND t.status = ?';
      params.push(status);
    }

    const dateFilter = buildDateFilter(start, end, 't.created_at');
    sql += dateFilter.query;
    params.push(...dateFilter.params);

    sql += ' GROUP BY t.id ORDER BY t.id DESC';

    const transactions = await db.allAsync(sql, params);
    res.json(transactions);
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: 'Gagal mengambil riwayat transaksi' });
  }
});

// Detail 1 Transaksi beserta Rincian Item (untuk Pratinjau & Cetak Ulang Struk)
app.get('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const transaction = await db.getAsync('SELECT * FROM transactions WHERE id = ?', [id]);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    }

    const items = await db.allAsync('SELECT * FROM transaction_items WHERE transaction_id = ?', [id]);
    const settings = await db.getAsync('SELECT * FROM settings WHERE id = 1');

    res.json({ transaction, items, settings });
  } catch (err) {
    console.error('Error fetching transaction detail:', err);
    res.status(500).json({ error: 'Gagal mengambil detail transaksi' });
  }
});

// ==========================================
// 4. API REPORTS & STATS (Laporan & Analitik)
// ==========================================

// Statistik 4 Kartu: Total Transaksi, Omzet, Modal (HPP), Laba Bersih
app.get('/api/reports/stats', async (req, res) => {
  try {
    const { start, end } = req.query;

    const dateFilter = buildDateFilter(start, end, 't.created_at');

    // Total Transaksi & Omzet
    const summarySql = `
      SELECT 
        COUNT(DISTINCT t.id) AS total_transactions,
        COALESCE(SUM(t.grand_total), 0) AS total_revenue
      FROM transactions t
      WHERE 1=1 ${dateFilter.query}
    `;
    const summary = await db.getAsync(summarySql, dateFilter.params);

    // Total Modal (HPP) berdasarkan buy_price saat transaksi terjadi
    const cogsSql = `
      SELECT 
        COALESCE(SUM(ti.qty * ti.buy_price), 0) AS total_cogs
      FROM transaction_items ti
      JOIN transactions t ON ti.transaction_id = t.id
      WHERE 1=1 ${dateFilter.query}
    `;
    const cogs = await db.getAsync(cogsSql, dateFilter.params);

    const total_transactions = summary ? summary.total_transactions : 0;
    const total_revenue = summary ? summary.total_revenue : 0;
    const total_cogs = cogs ? cogs.total_cogs : 0;
    const total_profit = total_revenue - total_cogs;

    res.json({
      total_transactions,
      total_revenue,
      total_cogs,
      total_profit
    });
  } catch (err) {
    console.error('Error fetching report stats:', err);
    res.status(500).json({ error: 'Gagal mengambil statistik laporan' });
  }
});

// ==========================================
// 5. EXPORT EXCEL (.xlsx) DENGAN 2 SHEET
// ==========================================
app.get('/api/reports/export', async (req, res) => {
  try {
    const { start, end, period_title } = req.query;

    // Filter tanggal
    const transDateFilter = buildDateFilter(start, end, 't.created_at');

    // Ambil data Ringkasan Transaksi
    const transactions = await db.allAsync(`
      SELECT 
        t.*,
        COALESCE(SUM(ti.qty), 0) AS total_items
      FROM transactions t
      LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
      WHERE 1=1 ${transDateFilter.query}
      GROUP BY t.id
      ORDER BY t.id ASC
    `, transDateFilter.params);

    // Ambil data Rincian Barang Terjual
    const itemDateFilter = buildDateFilter(start, end, 't.created_at');
    const itemsSold = await db.allAsync(`
      SELECT 
        t.invoice_number,
        datetime(t.created_at, 'localtime') AS trans_date,
        p.sku,
        ti.product_name,
        ti.qty,
        ti.buy_price,
        ti.sell_price,
        (ti.qty * ti.sell_price) AS item_revenue,
        (ti.qty * ti.buy_price) AS item_cogs,
        ((ti.qty * ti.sell_price) - (ti.qty * ti.buy_price)) AS item_profit
      FROM transaction_items ti
      JOIN transactions t ON ti.transaction_id = t.id
      LEFT JOIN products p ON ti.product_id = p.id
      WHERE 1=1 ${itemDateFilter.query}
      ORDER BY t.id ASC, ti.id ASC
    `, itemDateFilter.params);

    const settings = await db.getAsync('SELECT * FROM settings WHERE id = 1');
    const storeName = settings ? settings.store_name : 'TOKO SERBA ADA';

    // Inisialisasi Workbook Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = storeName;
    workbook.created = new Date();

    const currencyFormat = '"Rp "#,##0;("Rp "#,##0);"-"';

    // ----------------------------------------------------
    // SHEET 1: Ringkasan Transaksi
    // ----------------------------------------------------
    const sheet1 = workbook.addWorksheet('Ringkasan Transaksi', {
      views: [{ showGridLines: true }]
    });

    // Judul & Header Laporan Sheet 1
    sheet1.mergeCells('A1:I1');
    sheet1.getCell('A1').value = storeName.toUpperCase();
    sheet1.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF1E293B' } };
    sheet1.getCell('A1').alignment = { vertical: 'middle' };

    sheet1.mergeCells('A2:I2');
    sheet1.getCell('A2').value = 'LAPORAN RINGKASAN TRANSAKSI PENJUALAN';
    sheet1.getCell('A2').font = { size: 12, bold: true, color: { argb: 'FF334155' } };

    const periodeText = period_title
      ? `Periode: ${period_title.replace(/_/g, ' ')}`
      : ((start && end)
        ? `Periode: ${start} s/d ${end}`
        : (start ? `Mulai: ${start}` : (end ? `Sampai: ${end}` : 'Semua Periode')));
    sheet1.mergeCells('A3:I3');
    sheet1.getCell('A3').value = `${periodeText} | Dicetak: ${new Date().toLocaleString('id-ID')}`;
    sheet1.getCell('A3').font = { size: 10, italic: true, color: { argb: 'FF64748B' } };

    sheet1.addRow([]); // Baris kosong

    // Header Kolom Sheet 1
    const headerRow1 = sheet1.addRow([
      'No',
      'No. Invoice',
      'Tanggal & Waktu',
      'Jumlah Item',
      'Subtotal',
      'Diskon',
      'Total Bayar',
      'Tunai',
      'Kembalian'
    ]);

    headerRow1.height = 26;
    headerRow1.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E40AF' } // Biru Elegan
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    let sumTotalItems = 0;
    let sumSubtotal = 0;
    let sumDiscount = 0;
    let sumGrandTotal = 0;
    let sumCash = 0;
    let sumChange = 0;

    transactions.forEach((tx, index) => {
      sumTotalItems += (tx.total_items || 0);
      sumSubtotal += (tx.subtotal || 0);
      sumDiscount += (tx.discount || 0);
      sumGrandTotal += (tx.grand_total || 0);
      sumCash += (tx.cash_received || 0);
      sumChange += (tx.change_amount || 0);

      const row = sheet1.addRow([
        index + 1,
        tx.invoice_number,
        tx.created_at,
        tx.total_items || 0,
        tx.subtotal || 0,
        tx.discount || 0,
        tx.grand_total || 0,
        tx.cash_received || 0,
        tx.change_amount || 0
      ]);

      row.height = 20;

      // Styling Data Cells
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };

      // Format Mata Uang Rupiah
      for (let c = 5; c <= 9; c++) {
        row.getCell(c).numFmt = currencyFormat;
        row.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
      }

      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
      });
    });

    // Baris Total Sheet 1
    const totalRow1 = sheet1.addRow([
      'TOTAL',
      `${transactions.length} Transaksi`,
      '',
      sumTotalItems,
      sumSubtotal,
      sumDiscount,
      sumGrandTotal,
      sumCash,
      sumChange
    ]);

    totalRow1.height = 24;
    totalRow1.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' }
      };
      cell.font = { bold: true, color: { argb: 'FF0F172A' } };
      cell.border = {
        top: { style: 'medium' },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'double' },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
      };
      if (colNumber >= 5 && colNumber <= 9) {
        cell.numFmt = currencyFormat;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else if (colNumber === 4) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    });

    // Auto-fit kolom Sheet 1
    sheet1.columns.forEach((col) => {
      let maxLen = 0;
      col.eachCell({ includeEmpty: false }, (cell) => {
        const val = cell.value ? cell.value.toString() : '';
        if (val.length > maxLen) {
          maxLen = val.length;
        }
      });
      col.width = Math.max(maxLen + 4, 14);
    });
    sheet1.getColumn(1).width = 8;
    sheet1.getColumn(2).width = 24;
    sheet1.getColumn(3).width = 22;

    // ----------------------------------------------------
    // SHEET 2: Rincian Barang Terjual
    // ----------------------------------------------------
    const sheet2 = workbook.addWorksheet('Rincian Barang Terjual', {
      views: [{ showGridLines: true }]
    });

    sheet2.mergeCells('A1:K1');
    sheet2.getCell('A1').value = storeName.toUpperCase();
    sheet2.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF1E293B' } };
    sheet2.getCell('A1').alignment = { vertical: 'middle' };

    sheet2.mergeCells('A2:K2');
    sheet2.getCell('A2').value = 'LAPORAN RINCIAN BARANG TERJUAL & LABA BERSIH';
    sheet2.getCell('A2').font = { size: 12, bold: true, color: { argb: 'FF334155' } };

    sheet2.mergeCells('A3:K3');
    sheet2.getCell('A3').value = `${periodeText} | Dicetak: ${new Date().toLocaleString('id-ID')}`;
    sheet2.getCell('A3').font = { size: 10, italic: true, color: { argb: 'FF64748B' } };

    sheet2.addRow([]); // Baris kosong

    // Header Kolom Sheet 2
    const headerRow2 = sheet2.addRow([
      'No',
      'No. Invoice',
      'Tanggal & Waktu',
      'SKU',
      'Nama Barang',
      'Qty Terjual',
      'Harga Modal Satuan',
      'Harga Jual Satuan',
      'Total Omzet Item',
      'Total Modal Item',
      'Total Laba Bersih Item'
    ]);

    headerRow2.height = 26;
    headerRow2.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF065F46' } // Hijau Emerald Elegan
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    let sumQtySold = 0;
    let sumItemRevenue = 0;
    let sumItemCogs = 0;
    let sumItemProfit = 0;

    itemsSold.forEach((item, index) => {
      sumQtySold += (item.qty || 0);
      sumItemRevenue += (item.item_revenue || 0);
      sumItemCogs += (item.item_cogs || 0);
      sumItemProfit += (item.item_profit || 0);

      const row = sheet2.addRow([
        index + 1,
        item.invoice_number,
        item.trans_date,
        item.sku || '-',
        item.product_name,
        item.qty,
        item.buy_price,
        item.sell_price,
        item.item_revenue,
        item.item_cogs,
        item.item_profit
      ]);

      row.height = 20;

      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(5).alignment = { horizontal: 'left', vertical: 'middle' };
      row.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };

      for (let c = 7; c <= 11; c++) {
        row.getCell(c).numFmt = currencyFormat;
        row.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
      }

      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
      });
    });

    // Baris Total Sheet 2
    const totalRow2 = sheet2.addRow([
      'TOTAL',
      '',
      '',
      '',
      `${itemsSold.length} Rincian Item`,
      sumQtySold,
      '',
      '',
      sumItemRevenue,
      sumItemCogs,
      sumItemProfit
    ]);

    totalRow2.height = 24;
    totalRow2.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' }
      };
      cell.font = { bold: true, color: { argb: 'FF0F172A' } };
      cell.border = {
        top: { style: 'medium' },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'double' },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
      };
      if (colNumber >= 9 && colNumber <= 11) {
        cell.numFmt = currencyFormat;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else if (colNumber === 6) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    });

    // Auto-fit kolom Sheet 2
    sheet2.columns.forEach((col) => {
      let maxLen = 0;
      col.eachCell({ includeEmpty: false }, (cell) => {
        const val = cell.value ? cell.value.toString() : '';
        if (val.length > maxLen) {
          maxLen = val.length;
        }
      });
      col.width = Math.max(maxLen + 4, 14);
    });
    sheet2.getColumn(1).width = 8;
    sheet2.getColumn(2).width = 24;
    sheet2.getColumn(3).width = 22;
    sheet2.getColumn(5).width = 30;

    // Nama file unduhan rapi & dinamis
    let filename = 'Laporan_Kasir.xlsx';
    if (period_title) {
      const cleanTitle = period_title.trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_');
      filename = `Laporan_Kasir_${cleanTitle}.xlsx`;
    } else if (start && end) {
      filename = `Laporan_Kasir_${start}_sd_${end}.xlsx`;
    } else if (start) {
      filename = `Laporan_Kasir_Mulai_${start}.xlsx`;
    } else {
      filename = 'Laporan_Kasir_Semua_Periode.xlsx';
    }

    // Response Header untuk File Download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error generating Excel export:', err);
    res.status(500).json({ error: 'Gagal membuat file laporan Excel' });
  }
});

// Fallback untuk SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Menjalankan Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Aplikasi Kasir (POS) Offline Berhasil Berjalan!`);
  console.log(`🌐 Akses di browser: http://localhost:${PORT}`);
  console.log(`📁 Database SQLite : ./database/kasir.db`);
  console.log(`====================================================`);
});
