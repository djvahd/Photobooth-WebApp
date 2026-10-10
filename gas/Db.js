/**
 * Db.js — Google Sheets sebagai database sederhana.
 *
 * Tiap sheet = satu tabel, baris pertama = nama kolom (lihat SHEETS di Config.js).
 * Semua nilai disimpan sebagai TEKS supaya Sheets tidak mengubah tanggal/angka
 * secara otomatis; konversi tipe dilakukan di sini (lihat COLUMN_TYPES).
 */

let spreadsheetCache_ = null

function spreadsheet_() {
  if (!spreadsheetCache_) spreadsheetCache_ = SpreadsheetApp.openById(requireProp_('SPREADSHEET_ID'))
  return spreadsheetCache_
}

function encodeValue_(column, value) {
  const type = COLUMN_TYPES[column]
  if (value === undefined || value === null) return ''
  if (type === 'json') return JSON.stringify(value)
  if (type === 'bool') return value ? 'true' : 'false'
  return String(value)
}

function decodeValue_(column, raw) {
  const type = COLUMN_TYPES[column]
  // jaga-jaga kalau sel terlanjur diubah Sheets menjadi tanggal
  if (raw instanceof Date) return raw.toISOString()
  const text = raw === undefined || raw === null ? '' : String(raw)
  if (type === 'number') return text === '' ? 0 : Number(text)
  if (type === 'bool') return text === 'true' || text === 'TRUE'
  if (type === 'json') {
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch (err) {
      return null
    }
  }
  return text
}

function table_(name) {
  const headers = SHEETS[name]
  const sheet = spreadsheet_().getSheetByName(name)
  if (!sheet) throw new AppError('not_configured', `Sheet "${name}" tidak ada. Jalankan setup() dulu.`)

  function decode(values, rowNumber) {
    const obj = { _row: rowNumber }
    headers.forEach((h, i) => { obj[h] = decodeValue_(h, values[i]) })
    return obj
  }

  function encode(obj) {
    return headers.map(h => encodeValue_(h, obj[h]))
  }

  return {
    all() {
      const last = sheet.getLastRow()
      if (last < 2) return []
      return sheet.getRange(2, 1, last - 1, headers.length).getValues()
        .map((values, i) => decode(values, i + 2))
    },

    // baca satu kolom dulu, baru satu baris yang cocok (jauh lebih ringan daripada all())
    findBy(column, value) {
      const col = headers.indexOf(column)
      const last = sheet.getLastRow()
      if (col === -1 || last < 2) return null

      const values = sheet.getRange(2, col + 1, last - 1, 1).getValues()
      const i = values.findIndex(v => decodeValue_(column, v[0]) === value)
      if (i === -1) return null

      const rowNumber = i + 2
      return decode(sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0], rowNumber)
    },

    insert(obj) {
      // bukan appendRow: format teks dipasang DULU supaya tanggal ISO tidak
      // diubah otomatis oleh Sheets menjadi tipe tanggal
      const rowNumber = sheet.getLastRow() + 1
      if (rowNumber > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100)
      sheet.getRange(rowNumber, 1, 1, headers.length).setNumberFormat('@').setValues([encode(obj)])
      return Object.assign({ _row: rowNumber }, obj)
    },

    update(rowObj, patch) {
      const merged = Object.assign({}, rowObj, patch)
      sheet.getRange(rowObj._row, 1, 1, headers.length).setValues([encode(merged)])
      return merged
    },

    remove(rowObj) {
      sheet.deleteRow(rowObj._row)
    }
  }
}

// hapus field internal sebelum dikirim ke klien
function clean_(obj) {
  const out = Object.assign({}, obj)
  delete out._row
  return out
}
