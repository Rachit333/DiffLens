import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// Single connection pool shared across the app.
// postgres.js manages pooling internally — do not instantiate elsewhere.
const sql = postgres(process.env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: {
    // Return snake_case column names as-is (no camelCase transform for clarity)
    undefined: null,
  },
});

export default sql;
