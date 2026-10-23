declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ADMIN_EMAIL?: string;
    TELEGRAM_SECRET_KEY?: string;
    APP_ORIGIN?: string;
    BUCKET?: R2Bucket;
  }
}
