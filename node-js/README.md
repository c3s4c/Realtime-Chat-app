# Realtime Chat (Node.js + WebSocket + PostgreSQL 17)

این نسخه Node.js پروژه چت است که با حفظ ظاهر ساده نسخه قبلی، معماری backend به Express + WebSocket (`ws`) مهاجرت داده شده است.

## امکانات
- گفتگوی real-time با WebSocket
- وضعیت اتصال وب‌سوکت در بالای صفحه: متصل / درحال اتصال / قطع
- ریپلای به پیام با swipe (کشیدن راست/چپ روی پیام در موبایل)
- ساخت گروه توسط ادمین
- پنل ادمین برای:
  - افزودن / حذف / ویرایش کاربران
  - خواندن گفتگوها
  - پاکسازی دیتابیس گفتگوها
  - باز/بسته کردن ثبت‌نام
- بهینه‌سازی پایه برای موبایل (responsive)
- دیتابیس PostgreSQL 17

## اجرای محلی
1. پیش‌نیاز:
   - Node.js 20+
   - PostgreSQL 17
2. تنظیم env:
   ```bash
   cp .env.example .env
   ```
3. نصب وابستگی:
   ```bash
   npm install
   ```
4. اجرا:
   ```bash
   npm run dev
   ```

> ادمین اولیه به‌صورت خودکار ساخته می‌شود: `admin@local.dev` با رمز `admin123`

## راه‌اندازی روی PaaS

### Render / Railway / Fly.io (الگوی عمومی)
1. یک PostgreSQL 17 provision کنید.
2. متغیرهای محیطی را ست کنید:
   - `DATABASE_URL`
   - `SESSION_SECRET`
   - `PORT` (اختیاری، معمولاً PaaS خودش inject می‌کند)
3. Build command:
   ```bash
   npm install
   ```
4. Start command:
   ```bash
   npm start
   ```
5. در صورت وجود healthcheck، مسیر `/login` یا `/` را قرار دهید.
6. برای production بهتر است reverse proxy با TLS داشته باشید تا `wss` فعال شود.

## ساختار پوشه
- `src/server.js`: سرور Express + WebSocket
- `src/db.js`: اتصال و init دیتابیس
- `sql/schema.sql`: اسکیمای PostgreSQL
- `views/`: صفحات EJS
- `public/`: CSS و JS فرانت
