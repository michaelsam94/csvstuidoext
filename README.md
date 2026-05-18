# CSV Studio

View and edit CSV and TSV files as an interactive spreadsheet inside VS Code.

![CSV Studio screenshot placeholder](https://via.placeholder.com/800x450?text=CSV+Studio+Screenshot)

## Features

- **Custom editor** for `.csv` and `.tsv` files with a scrollable grid
- **Inline cell editing** with Tab, Enter, and arrow navigation
- **Toolbar**: add/delete rows and columns, sort, filter, undo/redo, find & replace, export
- **Sticky** header row and row-number column
- **Column**: click to sort, double-click to rename, right-click menu
- **Row**: click to select, right-click to insert, delete, or duplicate
- **Filter bar** per column (substring, case-insensitive)
- **Find & replace** panel with regex and whole-cell options
- **Virtual scrolling** for large files (configurable threshold, default 5000 rows)
- **Copy/paste** with Excel/Sheets-compatible tab-separated clipboard
- **Document sync** with the underlying file (VS Code undo, auto-save, external edits)
- **Export** CSV (save), JSON (new editor tab), TSV (save as)

## Usage

1. Open a `.csv` or `.tsv` file — it opens in CSV Studio by default.
2. Or right-click a CSV in the Explorer → **CSV Studio: Open as CSV Studio**.
3. Edit cells directly; changes sync to the file and respect `files.autoSave`.
4. Use the toolbar or command palette (`CSV Studio:` commands).

## Commands

| Command | Description |
|---------|-------------|
| CSV Studio: Open as CSV Studio | Open file in the custom editor |
| CSV Studio: Reload | Reparse from disk |
| CSV Studio: Add Row / Add Column | Append row or column |
| CSV Studio: Delete Row / Delete Column | Remove selection |
| CSV Studio: Sort Ascending / Descending | Sort by selected column |
| CSV Studio: Toggle Filter | Show filter inputs |
| CSV Studio: Undo / Redo | Grid history (also Ctrl+Z / Ctrl+Y in webview) |
| CSV Studio: Export JSON / Export TSV | Export formats |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `csvStudio.delimiter` | `auto` | `auto`, `,`, `;`, `\t`, `\|` |
| `csvStudio.hasHeader` | `true` | First row is headers |
| `csvStudio.maxRowsBeforeVirtualScroll` | `5000` | Virtual scroll threshold |
| `csvStudio.encoding` | `utf8` | Encoding hint for status bar |
| `csvStudio.dateFormat` | `YYYY-MM-DD` | Reserved for future date cells |

## Development

```bash
npm install
npm run compile
npm test
```

Press **F5** to launch the Extension Development Host.

## License

MIT
