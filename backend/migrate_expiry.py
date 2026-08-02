import sqlite3
import os

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "inventory.db")
con = sqlite3.connect(db_path)
c = con.cursor()
cols = [r[1] for r in c.execute("PRAGMA table_info(products)")]
added = []
if "batch_number" not in cols:
    c.execute('ALTER TABLE products ADD COLUMN batch_number VARCHAR(100) DEFAULT ""')
    added.append("batch_number")
if "expiry_date" not in cols:
    c.execute("ALTER TABLE products ADD COLUMN expiry_date DATE")
    added.append("expiry_date")
con.commit()
print("columns added:", added)
con.close()
