import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
		rules: {
			// "Inoreader" is a proper noun (the service brand). The
			// sentence-case rule wants it lowercased mid-sentence, which
			// would be wrong.
			"obsidianmd/ui/sentence-case": "off",
		},
	},
	{
		ignores: ["main.js", "node_modules/**"],
	},
]);
