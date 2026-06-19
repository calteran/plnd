// @ts-check
"use strict";

const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

// angular-eslint v22 consolidated its flat configs into the `angular-eslint`
// umbrella package; the individual `@angular-eslint/*` plugins no longer expose
// `.configs`. typescript-eslint is likewise consumed via its umbrella package.
module.exports = tseslint.config(
  // Ignore generated/third-party project directories
  { ignores: ["projects/**/*"] },

  // TypeScript sources: ESLint recommended + typescript-eslint recommended &
  // stylistic + angular recommended, with inline-template extraction so Angular
  // template rules apply to inline component templates.
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // Respect the _ prefix convention for intentionally unused params
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: "app", style: "camelCase" },
      ],
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: "app", style: "kebab-case" },
      ],
      // Angular 22 made OnPush the default change detection strategy; the v22
      // migration stamped `ChangeDetectionStrategy.Eager` on existing components
      // to preserve pre-v22 (CheckAlways) behavior. Adopting OnPush per component
      // is deferred to #983 — until then, do not flag the Eager opt-outs the
      // migration introduced.
      "@angular-eslint/prefer-on-push-component-change-detection": "off",
    },
  },

  // Angular template rules for HTML files
  {
    files: ["**/*.html"],
    extends: [...angular.configs.templateRecommended],
    rules: {},
  },
);
