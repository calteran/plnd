// @ts-check
"use strict";

const tsEslint = require("@typescript-eslint/eslint-plugin");
const angularEslint = require("@angular-eslint/eslint-plugin");
const angularTemplate = require("@angular-eslint/eslint-plugin-template");
const angularTemplateParser = require("@angular-eslint/template-parser");

module.exports = [
  // @typescript-eslint flat/recommended — sets up parser, plugins, and base rules for *.ts
  ...tsEslint.configs["flat/recommended"].map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),

  // Angular rules for TypeScript files, with inline template extraction
  {
    files: ["**/*.ts"],
    plugins: {
      "@angular-eslint": angularEslint,
    },
    processor: angularTemplate.processors["extract-inline-html"],
    rules: {
      ...angularEslint.configs.recommended.rules,
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: "app", style: "camelCase" },
      ],
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: "app", style: "kebab-case" },
      ],
    },
  },

  // Angular template rules for HTML files
  {
    files: ["**/*.html"],
    plugins: {
      "@angular-eslint/template": angularTemplate,
    },
    languageOptions: {
      parser: angularTemplateParser,
    },
    rules: {
      ...angularTemplate.configs.recommended.rules,
    },
  },
];
