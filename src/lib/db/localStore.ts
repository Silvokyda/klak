export class LocalJsonStore<T extends { id: string }> {
  constructor(private readonly key: string) {}

  list(): T[] {
    const raw = localStorage.getItem(this.key);
    return raw ? JSON.parse(raw) : [];
  }

  saveAll(rows: T[]): void {
    localStorage.setItem(this.key, JSON.stringify(rows));
  }

  upsert(row: T): T {
    const rows = this.list();
    const index = rows.findIndex((item) => item.id === row.id);
    if (index >= 0) rows[index] = row;
    else rows.unshift(row);
    this.saveAll(rows);
    return row;
  }

  delete(id: string): void {
    this.saveAll(this.list().filter((row) => row.id !== id));
  }
}
