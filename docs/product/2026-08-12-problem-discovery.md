# Problem Discovery — Zoldify

> **Cách dùng tài liệu này (đọc trước khi chép vào báo cáo).**
>
> Đây là nguồn cho **Chương I** của báo cáo — phần mô tả hệ thống hiện tại và
> Customer Requirements. Nội dung viết tiếng Anh để chép thẳng.
>
> **Nhóm chưa khảo sát ai.** Vì vậy tài liệu này tách rạch ròi hai loại nội dung:
>
> - Mục 2 và 3 là thứ **kiểm chứng được ngay** — ai cũng mở điện thoại ra xác
>   minh được trong 5 phút. Viết khẳng định.
> - Mục 4 và 5 là **giả định**, đóng dấu `[ASSUMPTION]`. Không được bỏ dấu này
>   khi chép sang báo cáo, trừ khi đã chạy khảo sát ở mục 6 và có số thật.
>
> Bịa một con số kiểu "78% sinh viên từng bị lừa" là cách nhanh nhất để mất
> điểm: giám khảo hỏi "khảo sát bao nhiêu người, khi nào" là hết đường lùi.

---

## 1. The transaction that fails today

Zoldify exists for one kind of trade: **an individual selling a single second-hand
or surplus item to another individual.** Not a shop clearing inventory — one
person, one item, sold once.

Today that trade runs on classified-ads platforms. The sequence is always the same:

1. The seller posts a listing with photos and a price.
2. The buyer sees it and opens a chat.
3. They agree on a price and a way to hand the item over.
4. **The buyer transfers money to a stranger's bank account, or hands over cash
   at a meetup.**
5. The item arrives, or it does not.

Step 4 is where the platform stops being involved. The listing site introduced the
two parties and then withdrew. Whatever happens to the money after that is a
private matter between two people who have never met.

Two failure modes follow directly from that gap:

**The deposit that buys nothing.** The seller asks for a deposit to "hold" the
item — a common and reasonable-sounding request when a popular listing has several
interested buyers. The buyer transfers it. The seller stops replying, deletes the
listing, and creates a new account. There is no transaction record on the platform
because the transaction never touched the platform.

**The item that is not what was described.** The buyer pays in full and receives
something with damage that was not in the photos, or a different model, or an
empty box. The money is already gone. The platform can remove the listing, but it
cannot reverse a bank transfer it never saw.

Both are the same underlying problem stated twice: **the platform hosts the
conversation but never holds the money, so it has nothing to give back.**

## 2. What we can verify without asking anyone

The claims in this section are about how existing products are built. Anyone can
check them by opening the apps. They do not require a survey.

**Facebook Marketplace has no checkout in Vietnam.** There is a listing, a photo,
a price, and a Messenger button. Payment, delivery, and dispute resolution all
happen outside the product. Meta provides no transaction record and takes no
position when a trade goes wrong.

**Selling groups on Facebook are the same thing with less structure.** A post, a
comment thread, a private message. No listing state, no seller history that
survives an account change, no price field the platform understands.

**Chợ Tốt is a classifieds platform first.** For general second-hand goods, the
default path is still: contact the seller, agree privately, pay by bank transfer
or cash on meetup. Chợ Tốt has built payment and delivery services into some
verticals over time, and it does operate buyer-protection features in parts of the
product.

> ⚠️ **Nhóm phải tự kiểm lại mục Chợ Tốt trước ngày bảo vệ.** Sản phẩm của họ
> thay đổi liên tục, và đây là loại khẳng định giám khảo mở điện thoại ra kiểm
> tra được ngay tại chỗ. Vào chotot.com, chọn một món đồ cũ thường (không phải
> xe hay nhà), xem có nút thanh toán trong sàn không, rồi cập nhật đoạn này kèm
> ngày kiểm. Nói "tính đến ngày 12/08/2026, với ngành hàng X, luồng mặc định
> là..." thì chắc chắn; nói "Chợ Tốt không có thanh toán" thì có thể sai.

**What none of them do — and this is the actual gap.** On every one of these
platforms, the money moves directly from the buyer's account to the seller's
account. No third party holds it in between. That single design choice is what
makes the deposit scam possible, and no amount of listing moderation or account
verification fixes it, because the fraud happens off-platform by design.

Zoldify's answer is one sentence: **the buyer's money goes to the platform, not to
the seller, and the seller is only paid after the buyer confirms the item arrived.**

## 3. Competitive landscape

| | Payment inside the platform | Who holds the money in transit | Dispute resolution | How it makes money |
|---|---|---|---|---|
| **Facebook Marketplace** (VN) | No | Nobody — direct transfer | None. Listing takedown only | Ads elsewhere |
| **Facebook selling groups** | No | Nobody — direct transfer | Group admin, informally | Nothing |
| **Chợ Tốt** | Partial, varies by category *(verify before defense)* | Depends on category | Varies | Listing promotion fees |
| **Shopee / Lazada** | Yes | The platform, until delivery | Formal, platform-run | Commission on sale |
| **Zoldify** | Yes | The platform, in escrow, on a double-entry ledger | Platform-run, with a full audit trail per transaction | Commission on released escrow |

The row that matters is the middle column. Shopee already solves the custody
problem — but Shopee is built for **merchants selling stock**, not for a person
selling one used camera. Its seller onboarding, inventory model, and return
policies all assume repeatable inventory.

So the market splits along two axes, and the empty quadrant is Zoldify's:

|  | Money held by platform | Money not held |
|---|---|---|
| **Merchants, repeatable stock** | Shopee, Lazada, TikTok Shop | — |
| **Individuals, one-off items** | **← Zoldify** | Chợ Tốt, Facebook Marketplace |

**This table is the answer to "why not just use Shopee".** Zoldify is not
competing with Shopee's catalog. It takes the payment-custody model that Shopee
proved works, and applies it to the one-off individual trade that Shopee's product
was never shaped for.

Note the honest limit of this claim: it says the quadrant is *underserved in
Vietnam for general second-hand goods*, not that it is empty worldwide. Mercari
(Japan) and Carousell (Southeast Asia) both occupy it, which is evidence the model
works rather than evidence against building it.

## 4. Who has the problem — `[ASSUMPTION]`

These two personas are **inferred, not researched.** They are written down so the
survey in section 6 can test them, and so that if they turn out to be wrong we can
tell which decisions were built on them.

### Persona A — the occasional seller `[ASSUMPTION]`

Someone who has three or four items sitting unused: a phone replaced last year, a
lens they stopped using, a bike. Not a business. They will sell maybe five things
this year.

What they want: to be paid without being cheated, and to spend as little effort as
possible. They will not build a shop, manage inventory, or learn a seller console.

Why they hesitate today: listing is free and easy, but the payment conversation is
uncomfortable. Asking a stranger to transfer first makes them look like a scammer;
shipping first means trusting a stranger.

### Persona B — the deliberate second-hand buyer `[ASSUMPTION]`

Someone buying used on purpose — for price, or because the item is discontinued.
They have browsed listings before and backed out at the payment step.

What they want: evidence that the money is recoverable if the item is wrong.

Why they hesitate today: the price is attractive precisely because there is no
protection, and they know it.

**The load-bearing assumption underneath both** is that the payment step, not
discovery, is what stops these trades. If people are actually stopped by
"there is nothing good listed", then escrow solves a problem nobody has and the
product needs supply first. **Question 7 in the survey is designed to separate
these two.**

## 5. Assumption register

Every belief the product rests on that we have not proved. Review this table
before the defense — an examiner asking "how do you know?" is asking about a row
in here.

| # | Assumption | If it is wrong | How to test it | Status |
|---|---|---|---|---|
| A1 | People abandon second-hand purchases at the payment step, not at discovery | Escrow is not the wedge; the product needs listing supply and search first | Survey Q7, Q8 | Untested |
| A2 | Buyers will accept the platform holding their money for days | Nobody completes checkout; the whole model fails | Survey Q9 | Untested |
| A3 | Sellers will accept being paid *after* delivery instead of before shipping | No supply; sellers stay on Chợ Tốt where they get paid first | Survey Q10 | Untested |
| A4 | Deposit fraud is common enough to be a felt problem, not a rare story | The pitch does not land emotionally; need a different angle | Survey Q3–Q5, plus a cited news source | Untested |
| A5 | A commission on completed sales is acceptable when listing elsewhere is free | Revenue model fails; sellers list on Chợ Tốt and pay nothing | Survey Q11 | Untested |
| A6 | Individuals will describe item condition honestly when a scale is offered | Condition ratings become noise; buyer trust erodes | Post-launch: dispute rate by declared condition | Untested |
| A7 | Chợ Tốt's general-goods flow still has no in-platform escrow | The core differentiator is already commoditised | Open the app and check *(see §2 warning)* | **Verify before defense** |

**A7 is the dangerous one.** It is the only assumption that a competitor can
invalidate without us noticing, and it is trivially checkable. Assign it to one
person with a date.

## 6. Survey instrument

Twelve questions. Designed to be answered in under three minutes so the response
rate does not collapse, and every question maps to a row in section 5. Run it on
Google Forms; target 40–60 responses, which is enough to see a clear split but not
enough to claim statistical significance — **say "40 responses" in the report, not
"our research shows"**.

**Screening**

1. Have you bought or sold a second-hand item online in the past 12 months?
   *(Yes, bought / Yes, sold / Both / Neither → if Neither, end)*
2. Which platforms did you use? *(Chợ Tốt / Facebook Marketplace / Facebook groups
   / Shopee / Other)*

**Experience of the problem — tests A4**

3. Have you ever transferred money for an online second-hand purchase and not
   received the item? *(Yes / No / Almost — I backed out)*
4. Have you ever received an item noticeably worse than described? *(Yes / No)*
5. Do you personally know someone this happened to? *(Yes / No)*

**Current behaviour**

6. When you buy second-hand, how do you usually pay? *(Bank transfer before
   receiving / Cash on meetup / Cash on delivery / Platform checkout)*

**The load-bearing question — tests A1**

7. Think of the last time you looked at a second-hand listing and did **not**
   buy. What stopped you? *(Single choice — Price / The item was not right /
   **I did not trust the seller** / **I did not want to transfer money first** /
   Seller stopped replying / Something else)*

8. If you have never sold something you no longer use, what stopped you?
   *(Effort / Did not know where / **Worried about being cheated** / Price too
   low to bother / I have sold before)*

**Willingness — tests A2, A3, A5**

9. *(Buyers)* Would you be willing to pay a platform that holds your money and
   releases it to the seller only after you confirm the item arrived?
   *(Definitely / Probably / Only for expensive items / No)*
10. *(Sellers)* Would you accept being paid after the buyer confirms delivery,
    instead of before you ship? *(Yes / Only for expensive items / No)*
11. *(Sellers)* If that protection meant the platform takes a commission on each
    completed sale, what rate feels acceptable? *(0% — I would not pay / 1–2% /
    3–5% / Over 5%)*
12. What is the highest price you would pay for a second-hand item from a
    stranger online? *(Under 500k / 500k–2tr / 2tr–10tr / Over 10tr)*

**Reading the results.** Q7 is the pivot. If "did not trust the seller" plus "did
not want to transfer first" is under about a third of answers, A1 is in trouble and
the product story needs revisiting before the report is written — not after.

Q12 also sets a real product parameter: it tells you the price band where escrow
actually matters, which is the band the demo should use.

## 7. What would prove us wrong

Stated in advance, so that finding it later is a result rather than an
embarrassment:

- Q7 shows people stop at **discovery**, not payment → escrow is a feature, not a
  wedge, and the differentiation argument in §3 collapses.
- Q10 shows sellers overwhelmingly refuse delayed payment → there is no supply
  side, and a marketplace without supply has nothing to demo.
- A7 turns out false — Chợ Tốt already runs escrow on general goods → the gap in
  the quadrant table is not a gap.

None of these would make the engineering work wrong. The double-entry ledger, the
idempotent webhook, and the concurrency tests are correct regardless of whether the
market wants them. They would change **the story told in Chapter I**, and it is much
cheaper to change that now than during the defense.

---

## Where this goes in the report

| Section here | Report location |
|---|---|
| §1 The transaction that fails today | I — *(mô tả hệ thống hiện tại)* |
| §2, §3 Verifiable gap + landscape | I — *(mô tả hệ thống hiện tại)*, leading into **Proposed System** |
| §4 Personas | I — **Customer Requirements**, and Actor rows in Chapter II use cases |
| §5 Assumption register | Appendix — *Some other issues* (limitations) |
| §6 Survey + results | I, once the survey has actually been run |
| §7 What would prove us wrong | Appendix — *Some other issues* |

Related: [`2026-08-12-pr-faq.md`](./2026-08-12-pr-faq.md) ·
[`2026-08-12-prd.md`](./2026-08-12-prd.md) ·
[`2026-08-12-user-flows.md`](./2026-08-12-user-flows.md)
