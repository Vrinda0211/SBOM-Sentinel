import "dotenv/config";

const required = [
  "MYSQL_HOST",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
];
const missing = required.filter((name) => process.env[name] === undefined);
if (missing.length > 0) {
  throw new Error(
    `Live MySQL tests require configured values for: ${missing.join(", ")}.`,
  );
}
