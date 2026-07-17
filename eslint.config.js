import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "dist-server/**", "node_modules/**", "coverage/**", "docs/project-intro/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/client/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off"
    }
  },
  {
    files: ["src/server/**/*.ts", "scripts/**/*.{js,mjs}", "*.config.ts"],
    languageOptions: { globals: globals.node }
  }
);
