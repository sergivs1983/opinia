module.exports = {
  root: true,
  extends: ["next/core-web-vitals"],
  plugins: ["@typescript-eslint"],
  rules: {
    // Register the rule so inline eslint-disable-next-line comments don't error.
    // Set to 'warn' to keep the existing suppression comments working.
    "@typescript-eslint/no-explicit-any": "warn",
  },
  ignorePatterns: ["node_modules/", ".next/", "out/", "dist/"],
};
