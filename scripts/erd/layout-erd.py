# TRANG THAI: CHUA NGHIEM THU (05/09/2026).
# Da qua kiem cu phap, CHUA chay that lan nao vi chua co file .mwb de thu.
# Chay xong lan dau thi sua dong nay lai, dung de nguyen roi tuong la da xong.
#
# Cach chay:
#   mysql-workbench --model=<file.mwb> \
#     --run-script=scripts/erd/layout-erd.py --quit-when-done
# Workbench khong xuat PNG, chi PDF/PostScript. Doi sang anh:
#   pdftoppm -png -r 300 erd-zoldify.pdf erd-zoldify
#
# Sap xep ERD theo module roi xuat PDF — khong dung chuot mot lan nao.
#
# Vi sao lam bang script: ban snap Workbench 8.0.36 ve lai man hinh sai vung,
# nen toa do widget that khong khop voi thu nhin thay -> keo tha bang chuot
# truot lung tung. Dat left/top bang so thi khong phu thuoc vao viec ve.
# Bonus: xep theo module deu tay hon keo tay 25 bang.
import os, sys, grt

out_dir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/erd"

# Nhom theo dung cay thu muc src/ cua repo, de so do doc ra kien truc
MODULES = [
    ("identity",  ["users", "addresses"]),
    ("catalog",   ["shops", "categories", "products", "files", "follows", "reviews"]),
    ("ordering",  ["carts", "orders", "order_items", "order_shipments"]),
    ("money",     ["wallets", "wallet_transactions", "payments", "escrows",
                   "withdrawals", "ledger_accounts", "ledger_transactions",
                   "ledger_entries", "payos_webhook_logs"]),
    ("messaging", ["conversations", "messages", "notifications"]),
    ("ops",       ["settings"]),
]
# migrations la bang ha tang cua TypeORM, khong thuoc mo hinh nghiep vu
BO_QUA = {"migrations"}

GAP_X, GAP_Y, LE = 60.0, 40.0, 40.0

doc = grt.root.wb.doc
if not doc.physicalModels:
    print("LOI: file .mwb khong co mo hinh nao"); sys.exit(1)

model = doc.physicalModels[0]
if not model.diagrams:
    print("LOI: mo hinh chua co so do nao"); sys.exit(1)

diagram = model.diagrams[0]

# gom figure theo ten bang
theo_ten = {}
for fig in diagram.figures:
    t = getattr(fig, "table", None)
    if t is not None:
        theo_ten[t.name] = fig

print("Tim thay %d hinh bang tren so do" % len(theo_ten))

x = LE
da_xep, cao_nhat = set(), 0.0
for ten_module, bang in MODULES:
    figs = [theo_ten[b] for b in bang if b in theo_ten]
    if not figs:
        continue
    y = LE
    rong_cot = 0.0
    for fig in figs:
        fig.left, fig.top = x, y
        y += fig.height + GAP_Y
        rong_cot = max(rong_cot, fig.width)
        da_xep.add(fig)
    print("  %-10s %2d bang  (cot x=%.0f)" % (ten_module, len(figs), x))
    cao_nhat = max(cao_nhat, y)
    x += rong_cot + GAP_X

# bang nao khong nam trong bang phan nhom o tren -> don xuong duoi, de thay ngay
con_lai = [f for f in diagram.figures
           if f not in da_xep and getattr(f, "table", None) is not None
           and f.table.name not in BO_QUA]
if con_lai:
    print("  CHUA PHAN NHOM: %s" % ", ".join(f.table.name for f in con_lai))
    cx = LE
    for fig in con_lai:
        fig.left, fig.top = cx, cao_nhat + GAP_Y
        cx += fig.width + GAP_X
    cao_nhat += GAP_Y + max(f.height for f in con_lai)

diagram.width = max(diagram.width, x + LE)
diagram.height = max(diagram.height, cao_nhat + LE)
print("Kich thuoc so do: %.0f x %.0f" % (diagram.width, diagram.height))

path = os.path.join(out_dir, "erd-zoldify.pdf")
grt.modules.WbPrinting.printToPDFFile(diagram, path)
print("DA XUAT: %s" % path)
