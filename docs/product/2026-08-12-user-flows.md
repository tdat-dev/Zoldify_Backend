# User Flows and UX — Zoldify

> **Cách dùng tài liệu này.**
>
> Nguồn cho **Chương III — UI Design**, và là bản đối chiếu để cập nhật sơ đồ
> `r7-screen-navigation.drawio`.
>
> Mọi luồng dưới đây viết theo **route có thật**, không phải luồng tưởng tượng:
> 35 trang Next.js và 3 màn Expo, liệt kê ngày 12/08/2026. Chỗ nào không có màn
> hình thì ghi thẳng là không có, chứ không vẽ hộp cho đẹp sơ đồ.
>
> Hai mục đáng đọc nhất là **§8 ma trận độ phủ** (biến khoảng cách web–mobile
> thành con số) và **§9 bốn khoảnh khắc lo tiền** (chỗ sản phẩm im lặng đúng lúc
> đáng lẽ phải lên tiếng).

---

## 1. Screen inventory

**Web — 35 pages** under `Zoldify_Frontend/src/app`:

| Area | Routes |
|---|---|
| Public | `/` · `/search` · `/category/[slug]` · `/product/[id]` · `/maintenance` |
| Auth | `/login` · `/register` · `/forgot-password` · `/reset-password` |
| Buying | `/cart` · `/cart/success` · `/checkout` · `/payment/return` · `/payment/cancel` |
| Buyer account | `/profile` · `/profile/orders` · `/profile/orders/[id]` · `/profile/wallet` · `/profile/products` · `/profile/change-password` · `/addresses` · `/addresses/create` · `/addresses/[id]/edit` · `/notifications` |
| Selling | `/product/create` · `/product/[id]/edit` · `/shop` · `/shop/orders` |
| Messaging | `/chat` |
| Admin | `/admin` · `/admin/orders` · `/admin/products` · `/admin/categories` · `/admin/users` · `/admin/settings` |

**Mobile — 3 screens** under `Zoldify_Mobile/src/app`:

| Screen | State |
|---|---|
| `login.tsx` | Real — wired to `api/auth.service.ts` |
| `index.tsx` | `HomeScreen` — product listing against `api/product.service.ts` |
| `explore.tsx` | **Unmodified Expo starter template** — `TabTwoScreen`, `Collapsible`, `ExternalLink`, `WebBadge` |

Counting honestly: **two real screens and one piece of scaffolding.**

## 2. Flow 1 — Register and sign in `UC-01, UC-02`

```
/register → enter email, password → OTP sent by email
          → enter OTP → verified → /login → session → /
```

- The account is unusable until the OTP is verified.
- Failure of the mail transport surfaces as an error rather than a silent success.
  This was a real bug, fixed in `6b54a2d`.
- **Mobile:** login exists. Registration does not — a new user cannot create an
  account from the app.

## 3. Flow 2 — List an item for sale `UC-03`

```
/product/create
  → title, description, photos
  → ConditionPicker: new | like_new | good | fair
  → price, category
  → submit → status = pending → admin review → status = active
```

- `ConditionPicker` is a shared component with a single source of truth for the
  four values, after an earlier bug where two pages each declared their own list
  and disagreed.
- **Two defects behind this screen**, both in
  [PRD §7](./2026-08-12-prd.md): the backend defaults condition to `new` when the
  field is absent, and it accepts any string. The web form happens to send a valid
  value; nothing else is required to.
- Editing goes through `/product/[id]/edit`, which normalises unrecognised
  historical values rather than blanking the field.
- **Mobile:** no listing screen. A seller cannot post from the app.

## 4. Flow 3 — Discover and evaluate `UC-04`

```
/ or /category/[slug] or /search
  → product card
  → /product/[id] → photos, price, ConditionBadge, seller, description
  → add to cart, or /chat with the seller
```

- `ConditionBadge` on the detail page is the one place the second-hand nature of
  the marketplace is visible in the interface.
- **Defect:** sold items are never marked sold, so they stay in these listings
  indefinitely — [PRD §7 gap 5](./2026-08-12-prd.md).
- **Mobile:** home screen lists products. No detail screen, no search, no
  category browse.

## 5. Flow 4 — Buy and pay `UC-05`

```
/cart → review
      → /checkout → receiver name, phone, address; payment method
      → PayOS: redirect to gateway → pay → /payment/return
              → webhook → order confirmed, escrow opened per seller
      → COD:   order created unpaid, no escrow
      → /cart/success
```

- Stock is verified under a row lock; the order and the stock decrement are one
  transaction.
- The webhook is idempotent on a deterministic key, so a replay credits once.
- `/payment/cancel` handles abandonment at the gateway.
- **The escrow — the entire reason this product exists — is created here and the
  interface never mentions it.** See §9.
- **Mobile:** none of this exists.

## 6. Flow 5 — Receive and release `UC-06, UC-07`

```
seller: /shop/orders → mark shipped
buyer:  /profile/orders/[id] → "confirm received"
        → escrow releases in one transaction, three legs:
            seller's available balance
            platform fee
            escrow account drained
```

- The confirm button belongs to the buyer alone. The seller cannot mark an item
  delivered — enforced by the status-transition policy and covered by a test
  sweeping all 49 status pairs.
- That button was missing until `ef6f301`; until then the purchase flow could
  never complete.
- **Defect:** if the buyer never presses it, the money is held forever. No timer
  exists — [PRD §7 gap 6](./2026-08-12-prd.md).
- **Mobile:** none of this exists.

## 7. Flow 6 — Get paid out `UC-08, UC-09`

```
seller: available balance → request withdrawal (amount, bank details)
        → money moves available → withdrawal_pending immediately
admin:  review → approve → complete → funds leave to bank_external
                → reject  → money returns to available
```

**None of this has an interface.**

The backend implements all three stages and nine integration tests cover them on a
real MySQL instance, including one asserting that two concurrent requests for the
whole balance cannot both succeed. But `/profile/wallet` — 243 lines — contains no
reference to withdrawal, and there is no `/admin/withdrawals` route.

A seller using Zoldify today can earn money and cannot take it out.

This is [PRD §7 gap 7](./2026-08-12-prd.md), and it is the single highest-value
piece of interface work in the project: two ordinary forms standing between the
product and a complete demonstration of its central promise.

## 8. Coverage matrix

| Flow | Web | Mobile | Backend |
|---|---|---|---|
| 1 · Register | ✅ | ❌ | ✅ |
| 1 · Log in | ✅ | ✅ | ✅ |
| 2 · List an item | ✅ | ❌ | ✅ |
| 3 · Browse | ✅ | 🟡 home only | ✅ |
| 3 · Search / filter | ✅ | ❌ | ✅ |
| 3 · Product detail | ✅ | ❌ | ✅ |
| 4 · Cart | ✅ | ❌ | ✅ |
| 4 · Checkout and pay | ✅ | ❌ | ✅ |
| 5 · Order history | ✅ | ❌ | ✅ |
| 5 · Confirm receipt | ✅ | ❌ | ✅ |
| 6 · Request withdrawal | ❌ | ❌ | ✅ |
| 6 · Approve withdrawal | ❌ | ❌ | ✅ |
| Chat | ✅ | ❌ | ✅ |
| Notifications | ✅ | ❌ | ✅ |
| Admin console | ✅ | n/a | ✅ |

**Read the columns, not the rows.**

The backend column is complete. The web column is complete except for withdrawal.
The mobile column has two ticks out of fourteen.

The capstone requires the app to run on Android **and** iOS against the deployed
API. As it stands the app can log a user in and show them a list of products. It
cannot buy anything.

**That is the real schedule risk in this project** — not the report, not the
diagrams, not the ledger. Every mobile row is work that has not started, and the
work cannot begin in earnest until the API is deployed, because the app must talk
to a real host rather than localhost.

## 9. The four moments the user worries about money

A marketplace built on payment custody has to *say so* at the moments the user is
deciding whether to trust it. Zoldify currently says nothing at any of them.

**Verified 12/08/2026:** the string `escrow` appears in the frontend only inside
`src/api/schema.d.ts` and a type alias in `src/api/index.ts` — both generated from
the OpenAPI spec. There is no user-facing wording about held funds anywhere in the
interface or in either language file.

| # | Moment | Screen | Says now | Should say |
|---|---|---|---|---|
| M1 | Deciding whether to pay a stranger | `/checkout` | Nothing about custody. Looks like any store checkout | Money is held by Zoldify, not sent to the seller, and released only when you confirm the item arrived |
| M2 | Paid, waiting for shipment | `/profile/orders/[id]` | Order status only | The amount is held. It has not reached the seller. Here is what happens if it never ships |
| M3 | Item in hand, about to confirm | `/profile/orders/[id]` | A button | Confirming pays the seller and is final. If the item is wrong, do not confirm — open a dispute |
| M4 | Seller, shipped, waiting to be paid | `/shop/orders` | Order status only | Payment is secured and held. It is released when the buyer confirms |

**M1 is the expensive one.** It is the moment the product either differentiates
itself or looks identical to every other checkout — and it is a paragraph of copy
plus a small amount of layout, not an engineering problem.

**M3 is the risky one.** Confirming receipt is irreversible and pays out the
money, and it is currently presented as an ordinary button. A user who taps it to
"acknowledge" the delivery has released their protection without being told.

Fixing all four is roughly a day of copy and component work, and it is the
difference between a marketplace that *has* escrow and one where the user can
*tell*.

## 10. What to update in the diagrams

`r7-screen-navigation.drawio` should reflect this document rather than the other
way round. Three changes:

1. Add the two missing withdrawal screens as **dashed** boxes labelled *not built*,
   so the diagram shows the gap instead of hiding it.
2. Split the mobile side into built and unbuilt — two screens solid, the rest
   dashed.
3. Mark the four trust moments on the buying path, since Chapter III must explain
   the escrow to a reader who cannot see it in the screenshots.

Do not regenerate the file with `npm run drawio:make --force` — the `.drawio`
files have been hand-edited since generation and force would discard that.

---

## Where this goes in the report

| Section here | Report location |
|---|---|
| §1 Screen inventory | III — **UI Design**, as the figure list |
| §2–§7 Flows | III — UI Design narrative; also the *Main Course* field of each Chapter II use case spec |
| §8 Coverage matrix | V — Task Assignment (it is the remaining-work list), and Appendix limitations |
| §9 Trust moments | III — UI Design rationale. This is the paragraph that explains **why the screens look the way they do**, which is the part most UI chapters omit |
| §10 Diagram updates | Applies to `docs/system-design/drawio/r7-screen-navigation.drawio` |

Related: [`2026-08-12-problem-discovery.md`](./2026-08-12-problem-discovery.md) ·
[`2026-08-12-pr-faq.md`](./2026-08-12-pr-faq.md) ·
[`2026-08-12-prd.md`](./2026-08-12-prd.md)
