// ============================================================
// APP.JS - Alpine.js Core POS & Application State Logic
// ============================================================

function posApp() {
  return {
    // Navigasi Tab: 'pos', 'products', 'debts', 'reports', 'settings'
    activeTab: 'pos',
    mobileMenuOpen: false,

    // Fitur Kasbon / Bayar Nanti
    paymentType: 'direct', // 'direct' (Bayar Langsung) atau 'later' (Bayar Nanti / Kasbon)
    customerName: '',

    // Data Kasbon
    debtList: [],
    debtSummary: {
      total_unpaid_count: 0,
      total_unpaid_amount: 0
    },
    debtSearch: '',
    showPayDebtModal: false,
    selectedDebt: null,
    debtCashReceived: 0,
    isSettlingDebt: false,

    // Notifikasi Toast
    toast: {
      show: false,
      message: '',
      type: 'success', // 'success', 'error', 'warning'
      timeout: null
    },

    showToast(message, type = 'success') {
      this.toast.message = message;
      this.toast.type = type;
      this.toast.show = true;
      if (this.toast.timeout) clearTimeout(this.toast.timeout);
      this.toast.timeout = setTimeout(() => {
        this.toast.show = false;
      }, 3500);
    },

    // Pengaturan Toko
    settings: {
      store_name: 'TOKO SERBA ADA',
      store_address: 'Jl. Raya Utama No. 1',
      store_phone: '0812-3456-7890',
      receipt_footer: 'Terima kasih telah berbelanja!',
      paper_size: '58mm'
    },

    // ----------------------------------------------------------
    // A. STATE & METODE POS / KASIR
    // ----------------------------------------------------------
    posProducts: [],
    posCategories: [],
    posSearch: '',
    selectedCategory: 'Semua',
    cart: [],
    discount: 0,
    cashReceived: 0,
    isProcessingCheckout: false,
    posMobileTab: 'catalog', // 'catalog' atau 'cart' untuk tampilan HP

    // Modal Struk
    showReceiptModal: false,
    currentReceipt: {
      transaction: null,
      items: [],
      settings: {}
    },

    // Inisialisasi Aplikasi
    async init() {
      await this.loadSettings();
      await this.loadPosProducts();
      await this.loadCategories();
      await this.loadProductsList();
      await this.loadProductsSummary();
      await this.loadDebts();
      this.initReportDates(); // Default laporan ke hari ini (real-time)
    },

    // Load Pengaturan Toko
    async loadSettings() {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          this.settings = await res.json();
        }
      } catch (err) {
        console.error('Error load settings:', err);
      }
    },

    // Simpan Pengaturan Toko
    async saveSettings() {
      try {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.settings)
        });
        const data = await res.json();
        if (res.ok) {
          this.showToast('Pengaturan toko berhasil disimpan!', 'success');
        } else {
          this.showToast(data.error || 'Gagal menyimpan pengaturan', 'error');
        }
      } catch (err) {
        this.showToast('Gagal menghubungi server', 'error');
      }
    },

    // Ambil produk untuk katalog POS
    async loadPosProducts() {
      try {
        let url = '/api/products';
        const params = new URLSearchParams();
        if (this.posSearch.trim()) params.append('search', this.posSearch.trim());
        if (this.selectedCategory && this.selectedCategory !== 'Semua') {
          params.append('category', this.selectedCategory);
        }
        if (params.toString()) url += `?${params.toString()}`;

        const res = await fetch(url);
        if (res.ok) {
          this.posProducts = await res.json();
        }
      } catch (err) {
        console.error('Error fetching pos products:', err);
      }
    },

    // Ambil daftar kategori unik
    async loadCategories() {
      try {
        const res = await fetch('/api/products/categories');
        if (res.ok) {
          const list = await res.json();
          this.posCategories = ['Semua', ...list];
        }
      } catch (err) {
        console.error('Error fetching categories:', err);
      }
    },

    // Filter kategori
    filterCategory(cat) {
      this.selectedCategory = cat;
      this.loadPosProducts();
    },

    // Handle input pencarian & Barcode Scanner USB (Trigger on Enter)
    handleSearchKeyup(e) {
      if (e.key === 'Enter') {
        const term = this.posSearch.trim().toLowerCase();
        if (!term) return;

        // Cek jika ada produk dengan SKU atau nama yang persis sama
        const matched = this.posProducts.find(
          p => p.sku.toLowerCase() === term || p.name.toLowerCase() === term
        );

        if (matched) {
          this.addToCart(matched);
          this.posSearch = ''; // Kosongkan input agar siap scan barcode berikutnya
          this.loadPosProducts();
        } else {
          // Jika pencarian umum
          this.loadPosProducts();
        }
      } else {
        // Live search
        this.loadPosProducts();
      }
    },

    // Tambah Produk ke Keranjang
    addToCart(product) {
      if (product.stock <= 0) {
        this.showToast(`Stok '${product.name}' sudah habis!`, 'warning');
        return;
      }

      const existingIndex = this.cart.findIndex(item => item.id === product.id);

      if (existingIndex > -1) {
        const currentQty = this.cart[existingIndex].qty;
        if (currentQty + 1 > product.stock) {
          this.showToast(
            `Stok '${product.name}' tidak mencukupi (Maksimal ${product.stock})`,
            'warning'
          );
          return;
        }
        this.cart[existingIndex].qty += 1;
      } else {
        this.cart.push({
          id: product.id,
          sku: product.sku,
          name: product.name,
          buy_price: product.buy_price,
          sell_price: product.sell_price,
          stock: product.stock,
          qty: 1
        });
      }
    },

    // Tambah Qty
    incrementQty(item) {
      if (item.qty + 1 > item.stock) {
        this.showToast(`Stok '${item.name}' hanya tersedia ${item.stock} unit`, 'warning');
        return;
      }
      item.qty += 1;
    },

    // Kurang Qty
    decrementQty(item) {
      if (item.qty > 1) {
        item.qty -= 1;
      } else {
        this.removeFromCart(item);
      }
    },

    // Update Qty Manual
    updateQtyManual(item, value) {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed < 1) {
        item.qty = 1;
        return;
      }
      if (parsed > item.stock) {
        item.qty = item.stock;
        this.showToast(`Stok maksimal untuk '${item.name}' adalah ${item.stock}`, 'warning');
      } else {
        item.qty = parsed;
      }
    },

    // Hapus Item dari Keranjang
    removeFromCart(item) {
      this.cart = this.cart.filter(i => i.id !== item.id);
    },

    // Bersihkan Keranjang
    clearCart() {
      this.cart = [];
      this.discount = 0;
      this.cashReceived = 0;
      this.customerName = '';
      this.paymentType = 'direct';
    },

    // Hitung Subtotal Keranjang
    getCartSubtotal() {
      return this.cart.reduce((total, item) => total + (item.sell_price * item.qty), 0);
    },

    // Hitung Grand Total (Subtotal - Diskon)
    getGrandTotal() {
      const subtotal = this.getCartSubtotal();
      const disc = Math.max(0, parseInt(this.discount, 10) || 0);
      return Math.max(0, subtotal - disc);
    },

    // Hitung Kembalian
    getChange() {
      const cash = Math.max(0, parseInt(this.cashReceived, 10) || 0);
      return cash - this.getGrandTotal();
    },

    // Tombol Cepat Nominal Uang
    setQuickCash(amount) {
      if (amount === 'exact') {
        this.cashReceived = this.getGrandTotal();
      } else {
        this.cashReceived = amount;
      }
    },

    addQuickCash(extra) {
      const current = parseInt(this.cashReceived, 10) || 0;
      this.cashReceived = current + extra;
    },

    // Cek apakah siap checkout
    canCheckout() {
      if (this.cart.length === 0 || this.isProcessingCheckout) return false;
      if (this.paymentType === 'later') {
        return this.customerName.trim().length > 0;
      }
      return (parseInt(this.cashReceived, 10) || 0) >= this.getGrandTotal();
    },

    // Proses Transaksi Kasir
    async processCheckout() {
      if (!this.canCheckout()) return;

      this.isProcessingCheckout = true;

      try {
        const isPayLater = this.paymentType === 'later';
        const payload = {
          items: this.cart.map(item => ({
            product_id: item.id,
            qty: item.qty
          })),
          discount: parseInt(this.discount, 10) || 0,
          cash_received: isPayLater ? (parseInt(this.cashReceived, 10) || 0) : (parseInt(this.cashReceived, 10) || 0),
          payment_method: isPayLater ? 'Bayar Nanti (Kasbon)' : 'Tunai',
          customer_name: this.customerName.trim() || (isPayLater ? 'Pelanggan Kasbon' : 'Pelanggan Umum'),
          payment_status: isPayLater ? 'Belum Lunas' : 'Lunas'
        };

        const res = await fetch('/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok) {
          // Buka modal struk thermal
          this.currentReceipt = {
            transaction: data.transaction,
            items: data.items,
            settings: data.settings || this.settings
          };
          this.showReceiptModal = true;

          // Bersihkan keranjang
          this.clearCart();
          this.posMobileTab = 'catalog';

          // Refresh data terbaru
          await this.loadPosProducts();
          await this.loadProductsList();
          await this.loadProductsSummary();
          await this.loadDebts();

          this.showToast(data.message || 'Transaksi berhasil disimpan!', 'success');
        } else {
          this.showToast(data.error || 'Gagal memproses transaksi', 'error');
        }
      } catch (err) {
        console.error('Checkout error:', err);
        this.showToast('Terjadi kesalahan jaringan/server saat checkout', 'error');
      } finally {
        this.isProcessingCheckout = false;
      }
    },

    // Cetak Struk Biasa (Dialog Browser / System Print)
    printReceipt() {
      window.print();
    },

    // ----------------------------------------------------------
    // FITUR CETAK BLUETOOTH THERMAL ESC/POS (IWARE RPP02N / MP-58BC)
    // ----------------------------------------------------------
    bluetoothDevice: null,
    bluetoothCharacteristic: null,
    isConnectingBluetooth: false,
    isPrintingBluetooth: false,
    bluetoothConnected: false,
    bluetoothDeviceName: '',
    bluetoothSupported: (typeof navigator !== 'undefined' && !!navigator.bluetooth),

    isAndroidDevice() {
      return /android/i.test(navigator.userAgent || '');
    },

    // Helper perataan teks untuk struk 58mm (32 Karakter per baris)
    padRow(left, right, width = 32) {
      left = String(left || '');
      right = String(right || '');
      const spaceNeeded = width - left.length - right.length;
      if (spaceNeeded > 0) {
        return left + ' '.repeat(spaceNeeded) + right;
      }
      return left + ' ' + right;
    },

    // Format Perintah Raw ESC/POS khusus untuk Iware RPP02N & MP-58BC (Lebar 58mm)
    buildEscPosReceipt() {
      const tx = this.currentReceipt.transaction || {};
      const items = this.currentReceipt.items || [];
      const set = this.currentReceipt.settings || this.settings || {};
      const width = 32; // Standar 58mm = 32 karakter per baris

      const ESC = '\x1B';

      let data = '';

      // 1. Reset / Inisialisasi Printer
      data += ESC + '@';

      // 2. Header Toko (Center & Bold)
      data += ESC + 'a' + '\x01'; // Align center
      data += ESC + 'E' + '\x01'; // Bold ON
      data += (set.store_name || 'TOKO SERBA ADA') + '\n';
      data += ESC + 'E' + '\x00'; // Bold OFF
      if (set.store_address) data += set.store_address + '\n';
      if (set.store_phone) data += 'Telp: ' + set.store_phone + '\n';

      // Garis Pemisah
      data += '-'.repeat(width) + '\n';

      // 3. Metadata Transaksi (Left Align)
      data += ESC + 'a' + '\x00'; // Align left
      data += this.padRow('No. Inv', tx.invoice_number || '-', width) + '\n';
      data += this.padRow('Tanggal', this.formatDateTime(tx.created_at), width) + '\n';
      if (tx.customer_name && tx.customer_name !== 'Pelanggan Umum') {
        data += this.padRow('Nama', tx.customer_name, width) + '\n';
      }
      data += this.padRow('Metode', tx.payment_method || 'Tunai', width) + '\n';
      if (tx.status === 'Belum Lunas') {
        data += ESC + 'E' + '\x01';
        data += this.padRow('STATUS', 'BELUM LUNAS / KASBON', width) + '\n';
        data += ESC + 'E' + '\x00';
      } else {
        data += this.padRow('Status', 'LUNAS', width) + '\n';
      }

      data += '-'.repeat(width) + '\n';

      // 4. Daftar Item Belanja
      for (const item of items) {
        data += item.product_name + '\n';
        const qtyPrice = `  ${item.qty} x ${parseInt(item.sell_price, 10).toLocaleString('id-ID')}`;
        const subtotal = parseInt(item.subtotal, 10).toLocaleString('id-ID');
        data += this.padRow(qtyPrice, subtotal, width) + '\n';
      }

      data += '-'.repeat(width) + '\n';

      // 5. Total, Diskon, Pembayaran
      const sub = parseInt(tx.subtotal || 0, 10).toLocaleString('id-ID');
      data += this.padRow('Subtotal', sub, width) + '\n';

      if (tx.discount > 0) {
        const disc = '-' + parseInt(tx.discount, 10).toLocaleString('id-ID');
        data += this.padRow('Diskon', disc, width) + '\n';
      }

      data += ESC + 'E' + '\x01'; // Bold ON
      const total = 'Rp ' + parseInt(tx.grand_total || 0, 10).toLocaleString('id-ID');
      data += this.padRow('TOTAL', total, width) + '\n';
      data += ESC + 'E' + '\x00'; // Bold OFF

      const cash = parseInt(tx.cash_received || 0, 10).toLocaleString('id-ID');
      data += this.padRow('Tunai', cash, width) + '\n';

      const change = parseInt(tx.change_amount || 0, 10).toLocaleString('id-ID');
      data += this.padRow('Kembalian', change, width) + '\n';

      data += '-'.repeat(width) + '\n';

      // 6. Footer Struk (Center)
      data += ESC + 'a' + '\x01'; // Align center
      data += (set.receipt_footer || 'Terima kasih telah berbelanja!') + '\n';
      data += 'POS Offline v1.0\n';

      // 7. Feed Kertas 4 baris agar struk keluar melewati pisau pemotong
      data += '\n\n\n\n';

      return new TextEncoder().encode(data);
    },

    // Hubungkan Web Bluetooth ke Printer Iware RPP02N / MP-58BC
    async connectBluetooth() {
      if (!navigator.bluetooth) {
        if (this.isAndroidDevice()) {
          this.showToast('Web Bluetooth di HP membutuhkan HTTPS atau aktifkan flag di Chrome. Anda juga bisa langsung gunakan tombol "Cetak RawBT".', 'warning');
        } else {
          this.showToast('Web Bluetooth tidak didukung di browser ini. Gunakan Google Chrome di Laptop / Mac.', 'warning');
        }
        return false;
      }

      this.isConnectingBluetooth = true;
      try {
        // Daftar semua UUID Service umum printer Bluetooth (Iware RPP02N, MP-58BC, Rongta, POS-58, Xprinter, Nordic UART)
        const knownServices = [
          0xfff0,
          0xffe0,
          0x18f0,
          0xfee7,
          0xff00,
          0xaf30,
          0xae30,
          0xae00,
          '0000fff0-0000-1000-8000-00805f9b34fb', // Utama Iware RPP02N / Rongta
          '0000ffe0-0000-1000-8000-00805f9b34fb', // Standard BLE 58mm
          '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic Semiconductor UART (Sangat umum di printer thermal)
          'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
          '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC transparent UART
          '000018f0-0000-1000-8000-00805f9b34fb',
          '0000ff00-0000-1000-8000-00805f9b34fb',
          '0000fee7-0000-1000-8000-00805f9b34fb',
          '0000af30-0000-1000-8000-00805f9b34fb',
          '0000ae30-0000-1000-8000-00805f9b34fb',
          '0000ae00-0000-1000-8000-00805f9b34fb',
          '0000e781-0000-1000-8000-00805f9b34fb'
        ];

        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: knownServices
        });

        // Event listener jika koneksi terputus
        device.addEventListener('gattserverdisconnected', () => {
          this.bluetoothConnected = false;
          this.bluetoothCharacteristic = null;
          this.showToast('Koneksi printer Bluetooth terputus', 'warning');
        });

        const server = await device.gatt.connect();

        let writeChar = null;

        // 1. Coba scan primary services yang terdeteksi
        try {
          const services = await server.getPrimaryServices();
          for (const service of services) {
            try {
              const chars = await service.getCharacteristics();
              for (const char of chars) {
                if (char.properties.write || char.properties.writeWithoutResponse) {
                  writeChar = char;
                  console.log('Ditemukan port cetak:', char.uuid, 'pada service:', service.uuid);
                  break;
                }
              }
            } catch (e) {}
            if (writeChar) break;
          }
        } catch (e) {
          console.warn('getPrimaryServices scan failed, trying individual services...', e);
        }

        // 2. Jika belum ketemu, coba cari satu per satu dari daftar UUID umum
        if (!writeChar) {
          for (const sUuid of knownServices) {
            try {
              const service = await server.getPrimaryService(sUuid);
              const chars = await service.getCharacteristics();
              for (const char of chars) {
                if (char.properties.write || char.properties.writeWithoutResponse) {
                  writeChar = char;
                  console.log('Ditemukan port cetak dari knownServices:', char.uuid);
                  break;
                }
              }
              if (writeChar) break;
            } catch (e) {
              // Lanjut ke service berikutnya
            }
          }
        }

        if (!writeChar) {
          throw new Error('Port cetak tidak ditemukan pada printer ini. Jika printer di-pair di Windows, silakan unpair (Remove device) di Windows Settings terlebih dahulu agar Chrome dapat mengakses port BLE.');
        }

        this.bluetoothDevice = device;
        this.bluetoothCharacteristic = writeChar;
        this.bluetoothConnected = true;
        this.bluetoothDeviceName = device.name || 'Iware RPP02N';
        this.showToast(`Printer "${this.bluetoothDeviceName}" berhasil terhubung!`, 'success');
        return true;
      } catch (err) {
        console.error('Bluetooth error:', err);
        if (err.name !== 'NotFoundError') {
          this.showToast('Gagal koneksi Bluetooth: ' + (err.message || 'Error'), 'error');
        }
        return false;
      } finally {
        this.isConnectingBluetooth = false;
      }
    },

    // Cetak Menggunakan Web Serial (Jalur Bluetooth SPP / Serial untuk Laptop)
    async printViaSerial() {
      if (!navigator.serial) {
        // Jika tidak mendukung serial, fallback ke printViaBluetooth
        return await this.printViaBluetooth();
      }
      this.isPrintingBluetooth = true;
      try {
        this.showToast('Pilih perangkat Bluetooth / COM printer di jendela Chrome...', 'info');
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });
        const writer = port.writable.getWriter();
        const rawBytes = this.buildEscPosReceipt();
        await writer.write(rawBytes);
        writer.releaseLock();
        await port.close();
        this.showToast('Struk berhasil dicetak ke printer Iware MP-58BC!', 'success');
      } catch (err) {
        console.error('Serial print error:', err);
        if (err.name !== 'NotFoundError') {
          this.showToast('Gagal cetak serial: ' + (err.message || 'Error'), 'error');
        }
      } finally {
        this.isPrintingBluetooth = false;
      }
    },

    // Cetak Langsung lewat Web Bluetooth ke Iware RPP02N / MP-58BC
    async printViaBluetooth() {
      if (!this.bluetoothCharacteristic) {
        const ok = await this.connectBluetooth();
        if (!ok) return;
      }

      this.isPrintingBluetooth = true;
      try {
        const rawBytes = this.buildEscPosReceipt();
        // Kirim dalam potongan paket 80 byte agar buffer printer tidak overflow
        const chunkSize = 80;
        for (let i = 0; i < rawBytes.length; i += chunkSize) {
          const chunk = rawBytes.slice(i, i + chunkSize);
          if (this.bluetoothCharacteristic.properties.writeWithoutResponse) {
            await this.bluetoothCharacteristic.writeValueWithoutResponse(chunk);
          } else {
            await this.bluetoothCharacteristic.writeValue(chunk);
          }
          await new Promise(r => setTimeout(r, 25));
        }
        this.showToast('Struk berhasil dicetak ke printer!', 'success');
      } catch (err) {
        console.error('Print bluetooth error:', err);
        this.bluetoothCharacteristic = null;
        this.bluetoothConnected = false;
        this.showToast('Gagal mencetak Bluetooth: ' + err.message, 'error');
      } finally {
        this.isPrintingBluetooth = false;
      }
    },

    // Cetak Menggunakan Aplikasi RawBT (Sangat Direkomendasikan untuk HP Android)
    printViaRawBT() {
      try {
        const rawBytes = this.buildEscPosReceipt();
        let binary = '';
        for (let i = 0; i < rawBytes.byteLength; i++) {
          binary += String.fromCharCode(rawBytes[i]);
        }
        const b64 = btoa(binary);

        // Buka protokol RawBT
        const rawbtUrl = 'rawbt:data:application/octet-stream;base64,' + b64;
        const link = document.createElement('a');
        link.href = rawbtUrl;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
          document.body.removeChild(link);
        }, 1000);

        this.showToast('Mengirim perintah cetak ke RawBT...', 'success');
      } catch (err) {
        console.error('RawBT print error:', err);
        this.showToast('Gagal memproses struk RawBT: ' + err.message, 'error');
      }
    },

    // Tutup Modal Struk & Reset
    closeReceiptModal() {
      this.showReceiptModal = false;
      this.currentReceipt = { transaction: null, items: [], settings: {} };
    },

    // ----------------------------------------------------------
    // B. STATE & METODE DATA BARANG (CRUD PRODUK)
    // ----------------------------------------------------------
    productsList: [],
    productSearch: '',
    productCategoryFilter: 'Semua',
    filterLowStockOnly: false,
    productsSummary: {
      total_products: 0,
      total_units: 0,
      total_asset_value: 0,
      low_stock_count: 0
    },

    // Modal Tambah / Edit Produk
    showProductModal: false,
    isEditingProduct: false,
    productForm: {
      id: null,
      sku: '',
      name: '',
      category: '',
      buy_price: 0,
      sell_price: 0,
      stock: 0
    },
    formError: '',

    async loadProductsSummary() {
      try {
        const res = await fetch('/api/products/summary');
        if (res.ok) {
          this.productsSummary = await res.json();
        }
      } catch (err) {
        console.error('Error load summary:', err);
      }
    },

    async loadProductsList() {
      try {
        let url = '/api/products';
        const params = new URLSearchParams();
        if (this.productSearch.trim()) params.append('search', this.productSearch.trim());
        if (this.productCategoryFilter && this.productCategoryFilter !== 'Semua') {
          params.append('category', this.productCategoryFilter);
        }
        if (this.filterLowStockOnly) params.append('low_stock', 'true');

        if (params.toString()) url += `?${params.toString()}`;

        const res = await fetch(url);
        if (res.ok) {
          this.productsList = await res.json();
        }
      } catch (err) {
        console.error('Error load products list:', err);
      }
    },

    // Buka Modal Tambah Produk
    openAddProductModal() {
      this.isEditingProduct = false;
      this.formError = '';
      this.productForm = {
        id: null,
        sku: this.generateAutoSku(),
        name: '',
        category: '',
        buy_price: 0,
        sell_price: 0,
        stock: 0
      };
      this.showProductModal = true;
    },

    // Buka Modal Edit Produk
    openEditProductModal(prod) {
      this.isEditingProduct = true;
      this.formError = '';
      this.productForm = {
        id: prod.id,
        sku: prod.sku,
        name: prod.name,
        category: prod.category || '',
        buy_price: prod.buy_price,
        sell_price: prod.sell_price,
        stock: prod.stock
      };
      this.showProductModal = true;
    },

    // Generate SKU Unik Otomatis
    generateAutoSku() {
      const random = Math.floor(1000 + Math.random() * 9000);
      return `PRD-${Date.now().toString().slice(-4)}${random.toString().slice(-2)}`;
    },

    // Kalkulasi Margin untuk Form Produk
    getProductMarginRp() {
      const buy = parseInt(this.productForm.buy_price, 10) || 0;
      const sell = parseInt(this.productForm.sell_price, 10) || 0;
      return sell - buy;
    },

    getProductMarginPercent() {
      const buy = parseInt(this.productForm.buy_price, 10) || 0;
      const sell = parseInt(this.productForm.sell_price, 10) || 0;
      if (buy <= 0) return 0;
      return (((sell - buy) / buy) * 100).toFixed(1);
    },

    // Simpan Produk (Tambah atau Edit)
    async saveProduct() {
      this.formError = '';

      if (!this.productForm.sku.trim()) {
        this.formError = 'SKU wajib diisi';
        return;
      }
      if (!this.productForm.name.trim()) {
        this.formError = 'Nama barang wajib diisi';
        return;
      }
      if (this.productForm.sell_price < this.productForm.buy_price) {
        if (!confirm('Peringatan: Harga Jual lebih kecil dari Harga Modal (berpotensi rugi). Apakah Anda yakin ingin melanjutkan?')) {
          return;
        }
      }

      try {
        const method = this.isEditingProduct ? 'PUT' : 'POST';
        const url = this.isEditingProduct
          ? `/api/products/${this.productForm.id}`
          : '/api/products';

        const res = await fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.productForm)
        });

        const data = await res.json();

        if (res.ok) {
          this.showProductModal = false;
          this.showToast(data.message || 'Barang berhasil disimpan', 'success');
          await this.loadProductsList();
          await this.loadProductsSummary();
          await this.loadCategories();
          await this.loadPosProducts();
        } else {
          this.formError = data.error || 'Gagal menyimpan barang';
        }
      } catch (err) {
        this.formError = 'Terjadi kesalahan pada server';
      }
    },

    // Hapus Produk
    async deleteProduct(prod) {
      if (!confirm(`Hapus produk "${prod.name}" (SKU: ${prod.sku})? Tindakan ini tidak dapat dibatalkan.`)) {
        return;
      }

      try {
        const res = await fetch(`/api/products/${prod.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
          this.showToast(data.message || 'Produk berhasil dihapus', 'success');
          await this.loadProductsList();
          await this.loadProductsSummary();
          await this.loadPosProducts();
        } else {
          this.showToast(data.error || 'Gagal menghapus produk', 'error');
        }
      } catch (err) {
        this.showToast('Gagal menghapus produk', 'error');
      }
    },

    // ----------------------------------------------------------
    // C. STATE & METODE LAPORAN & RIWAYAT TRANSAKSI
    // ----------------------------------------------------------
    reportDatePreset: 'today', // 'today', 'week', 'month', 'year', 'custom', 'all'
    reportStartDate: '',
    reportEndDate: '',
    reportSearchInvoice: '',
    reportSelectedDate: '', // Format 'YYYY-MM-DD' untuk mode harian
    reportSelectedMonth: new Date().getMonth() + 1, // 1 - 12
    reportSelectedYear: new Date().getFullYear(),
    reportSelectedYearOnly: new Date().getFullYear(),

    // Daftar Pilihan Bulan
    monthsList: [
      { val: 1, name: 'Januari' },
      { val: 2, name: 'Februari' },
      { val: 3, name: 'Maret' },
      { val: 4, name: 'April' },
      { val: 5, name: 'Mei' },
      { val: 6, name: 'Juni' },
      { val: 7, name: 'Juli' },
      { val: 8, name: 'Agustus' },
      { val: 9, name: 'September' },
      { val: 10, name: 'Oktober' },
      { val: 11, name: 'November' },
      { val: 12, name: 'Desember' }
    ],

    // Daftar Pilihan Tahun
    yearsList: [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030],

    reportStats: {
      total_transactions: 0,
      total_revenue: 0,
      total_cogs: 0,
      total_profit: 0
    },
    transactionsHistory: [],

    // Helper format tanggal YYYY-MM-DD
    formatDateISO(d) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    },

    // Inisialisasi awal tanggal laporan
    initReportDates() {
      const today = new Date();
      this.reportSelectedDate = this.formatDateISO(today);
      this.reportSelectedMonth = today.getMonth() + 1;
      this.reportSelectedYear = today.getFullYear();
      this.reportSelectedYearOnly = today.getFullYear();
      this.setDatePreset('today');
    },

    // Atur preset filter tanggal cepat (Hari, Minggu, Bulan, Tahun, Semua)
    setDatePreset(preset) {
      this.reportDatePreset = preset;
      const today = new Date();

      if (preset === 'today') {
        if (!this.reportSelectedDate) {
          this.reportSelectedDate = this.formatDateISO(today);
        }
        this.reportStartDate = this.reportSelectedDate;
        this.reportEndDate = this.reportSelectedDate;
      } else if (preset === 'week') {
        const past = new Date();
        past.setDate(today.getDate() - 6);
        this.reportStartDate = this.formatDateISO(past);
        this.reportEndDate = this.formatDateISO(today);
      } else if (preset === 'month') {
        this.applyMonthFilter();
        return;
      } else if (preset === 'year') {
        this.applyYearFilter();
        return;
      } else if (preset === 'all') {
        this.reportStartDate = '';
        this.reportEndDate = '';
      }

      this.fetchReports();
    },

    // Filter saat tanggal harian diubah
    onDayChange() {
      if (this.reportSelectedDate) {
        this.reportStartDate = this.reportSelectedDate;
        this.reportEndDate = this.reportSelectedDate;
        this.fetchReports();
      }
    },

    // Filter saat bulan / tahun diubah
    applyMonthFilter() {
      const m = parseInt(this.reportSelectedMonth, 10) || 1;
      const y = parseInt(this.reportSelectedYear, 10) || new Date().getFullYear();
      const lastDay = new Date(y, m, 0).getDate();
      const padM = String(m).padStart(2, '0');
      const padLastDay = String(lastDay).padStart(2, '0');

      this.reportStartDate = `${y}-${padM}-01`;
      this.reportEndDate = `${y}-${padM}-${padLastDay}`;
      this.fetchReports();
    },

    // Filter saat tahun diubah
    applyYearFilter() {
      const y = parseInt(this.reportSelectedYearOnly, 10) || new Date().getFullYear();
      this.reportStartDate = `${y}-01-01`;
      this.reportEndDate = `${y}-12-31`;
      this.fetchReports();
    },

    // Teks deskripsi periode yang mudah dibaca di layar
    getReportDisplayTitle() {
      if (this.reportDatePreset === 'today') {
        if (!this.reportSelectedDate) return 'Hari Ini';
        const parts = this.reportSelectedDate.split('-');
        if (parts.length === 3) {
          const d = new Date(parts[0], parts[1] - 1, parts[2]);
          return 'Laporan: ' + d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        }
        return 'Laporan Hari Ini';
      } else if (this.reportDatePreset === 'week') {
        return `Laporan 7 Hari: ${this.reportStartDate} s/d ${this.reportEndDate}`;
      } else if (this.reportDatePreset === 'month') {
        const mObj = this.monthsList.find(x => x.val === parseInt(this.reportSelectedMonth, 10));
        const mName = mObj ? mObj.name : `Bulan ${this.reportSelectedMonth}`;
        return `Laporan: Bulan ${mName} ${this.reportSelectedYear}`;
      } else if (this.reportDatePreset === 'year') {
        return `Laporan: Tahun ${this.reportSelectedYearOnly}`;
      } else if (this.reportDatePreset === 'all') {
        return 'Laporan: Seluruh Riwayat';
      } else {
        return `Laporan Rentang: ${this.reportStartDate || 'Awal'} s/d ${this.reportEndDate || 'Akhir'}`;
      }
    },

    // Label untuk nama file unduhan Excel
    getReportPeriodLabel() {
      if (this.reportDatePreset === 'today') {
        return `Harian_${this.reportSelectedDate || 'Hari_Ini'}`;
      } else if (this.reportDatePreset === 'week') {
        return `Mingguan_${this.reportStartDate}_sd_${this.reportEndDate}`;
      } else if (this.reportDatePreset === 'month') {
        const mObj = this.monthsList.find(x => x.val === parseInt(this.reportSelectedMonth, 10));
        const mName = mObj ? mObj.name : `Bulan_${this.reportSelectedMonth}`;
        return `Bulan_${mName}_${this.reportSelectedYear}`;
      } else if (this.reportDatePreset === 'year') {
        return `Tahun_${this.reportSelectedYearOnly}`;
      } else if (this.reportDatePreset === 'all') {
        return 'Semua_Transaksi';
      } else {
        return `Rentang_${this.reportStartDate || 'Awal'}_sd_${this.reportEndDate || 'Akhir'}`;
      }
    },

    // Ambil data statistik laporan & daftar transaksi
    async fetchReports() {
      try {
        const params = new URLSearchParams();
        if (this.reportStartDate) params.append('start', this.reportStartDate);
        if (this.reportEndDate) params.append('end', this.reportEndDate);
        if (this.reportSearchInvoice.trim()) params.append('search', this.reportSearchInvoice.trim());

        const statsUrl = `/api/reports/stats?${params.toString()}`;
        const transUrl = `/api/transactions?${params.toString()}`;

        const [statsRes, transRes] = await Promise.all([
          fetch(statsUrl),
          fetch(transUrl)
        ]);

        if (statsRes.ok) {
          this.reportStats = await statsRes.json();
        }
        if (transRes.ok) {
          this.transactionsHistory = await transRes.json();
        }
      } catch (err) {
        console.error('Error fetching reports:', err);
      }
    },

    // Lihat Detail / Cetak Ulang Struk dari Riwayat
    async viewTransactionDetail(tx) {
      try {
        const res = await fetch(`/api/transactions/${tx.id}`);
        if (res.ok) {
          const data = await res.json();
          this.currentReceipt = {
            transaction: data.transaction,
            items: data.items,
            settings: data.settings || this.settings
          };
          this.showReceiptModal = true;
        } else {
          this.showToast('Gagal memuat detail transaksi', 'error');
        }
      } catch (err) {
        this.showToast('Terjadi kesalahan memuat detail transaksi', 'error');
      }
    },

    // Export Laporan ke Excel (.xlsx) dengan parameter nama periode
    exportExcel() {
      const params = new URLSearchParams();
      if (this.reportStartDate) params.append('start', this.reportStartDate);
      if (this.reportEndDate) params.append('end', this.reportEndDate);
      const title = this.getReportPeriodLabel();
      params.append('period_title', title);
      const downloadUrl = `/api/reports/export?${params.toString()}`;
      window.location.href = downloadUrl;
      this.showToast(`Mengunduh Excel: ${title}.xlsx`, 'success');
    },

    // ----------------------------------------------------------
    // D. STATE & METODE BUKU KASBON / BAYAR NANTI
    // ----------------------------------------------------------
    async loadDebts() {
      try {
        let url = '/api/debts';
        if (this.debtSearch.trim()) {
          url += `?search=${encodeURIComponent(this.debtSearch.trim())}`;
        }
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          this.debtList = data.debts || [];
          this.debtSummary = data.summary || { total_unpaid_count: 0, total_unpaid_amount: 0 };
        }
      } catch (err) {
        console.error('Error load debts:', err);
      }
    },

    openPayDebtModal(debt) {
      this.selectedDebt = debt;
      this.debtCashReceived = debt.grand_total; // Default uang pas
      this.showPayDebtModal = true;
    },

    closePayDebtModal() {
      this.showPayDebtModal = false;
      this.selectedDebt = null;
      this.debtCashReceived = 0;
    },

    getDebtChange() {
      if (!this.selectedDebt) return 0;
      const cash = parseInt(this.debtCashReceived, 10) || 0;
      return cash - this.selectedDebt.grand_total;
    },

    canSettleDebt() {
      if (!this.selectedDebt || this.isSettlingDebt) return false;
      const cash = parseInt(this.debtCashReceived, 10) || 0;
      return cash >= this.selectedDebt.grand_total;
    },

    async settleDebt() {
      if (!this.canSettleDebt()) return;

      this.isSettlingDebt = true;
      try {
        const res = await fetch(`/api/transactions/${this.selectedDebt.id}/pay`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cash_received: this.debtCashReceived })
        });

        const data = await res.json();
        if (res.ok) {
          this.showToast(data.message || 'Kasbon berhasil dilunasi!', 'success');
          this.closePayDebtModal();

          // Buka struk pelunasan
          this.currentReceipt = {
            transaction: data.transaction,
            items: data.items,
            settings: data.settings || this.settings
          };
          this.showReceiptModal = true;

          await this.loadDebts();
          await this.fetchReports();
        } else {
          this.showToast(data.error || 'Gagal melunasi kasbon', 'error');
        }
      } catch (err) {
        console.error('Settle debt error:', err);
        this.showToast('Gagal menghubungi server', 'error');
      } finally {
        this.isSettlingDebt = false;
      }
    },

    // ----------------------------------------------------------
    // D. HELPER FORMATTING
    // ----------------------------------------------------------
    formatRupiah(value) {
      const num = parseInt(value, 10) || 0;
      return 'Rp ' + num.toLocaleString('id-ID');
    },

    formatDateTime(dateStr) {
      if (!dateStr) return '-';
      try {
        const str = String(dateStr).trim();
        const parts = str.split(/[- :T]/);
        if (parts.length >= 5) {
          const year = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const day = parseInt(parts[2], 10);
          const hour = parseInt(parts[3], 10);
          const min = parseInt(parts[4], 10);
          const sec = parseInt(parts[5] || 0, 10);
          const d = new Date(year, month, day, hour, min, sec);
          return d.toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
          }) + ', ' + String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0') + (parts[5] ? ':' + String(sec).padStart(2, '0') : '');
        }
        const d = new Date(dateStr);
        return d.toLocaleString('id-ID', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      } catch (e) {
        return dateStr;
      }
    }
  };
}
