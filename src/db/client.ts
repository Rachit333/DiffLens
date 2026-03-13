// import postgres from "postgres";

// if (!process.env.DATABASE_URL) {
//   throw new Error("DATABASE_URL is not set");
// }

// // Single connection pool shared across the app.
// // postgres.js manages pooling internally — do not instantiate elsewhere.
// const sql = postgres(process.env.DATABASE_URL, {
//   max: 10,
//   idle_timeout: 30,
//   connect_timeout: 10,
//   transform: {
//     // Return snake_case column names as-is (no camelCase transform for clarity)
//     undefined: null,
//   },
// });

// export default sql;


// Both snippets ultimately create **one `postgres` connection pool** and export it as `sql`, so their runtime behavior is effectively the same in this file.
// The first version initializes the pool **directly at module load**, which guarantees a singleton via Node’s module caching.
// The second wraps initialization in a **factory function**, which is slightly more flexible but could accidentally create multiple pools if reused elsewhere.
// The first version is more concise and idiomatic for a shared database client in Node.js, while the second adds unnecessary complexity without clear benefits in this context.


import postgres from "postgres";

function getClient() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return postgres(process.env.DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    transform: { undefined: null },
  });
}

const sql = getClient();
export default sql;