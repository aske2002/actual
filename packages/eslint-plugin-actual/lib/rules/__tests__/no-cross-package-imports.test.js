import { runClassic } from 'eslint-vitest-rule-tester';

import * as rule from '../no-cross-package-imports';

void runClassic(
  'no-cross-package-imports',
  rule,
  {
    valid: [
      // @actual-app/web can import @actual-app/core (declared dep)
      {
        code: 'import { something } from "@actual-app/core";',
        filename: 'packages/desktop-client/src/components/Test.tsx',
      },
      // @actual-app/web can import @actual-app/components (declared dep)
      {
        code: 'import { Button } from "@actual-app/components";',
        filename: 'packages/desktop-client/src/components/Test.tsx',
      },
      // External packages are always allowed
      {
        code: 'import React from "react";',
        filename: 'packages/component-library/src/Button.tsx',
      },
      // Relative imports are always allowed
      {
        code: 'import { helper } from "./utils";',
        filename: 'packages/component-library/src/Button.tsx',
      },
      // Files outside packages/ are not checked
      {
        code: 'import { something } from "@actual-app/core";',
        filename: 'scripts/build.js',
      },
      // @actual-app/api can import @actual-app/core (declared dep)
      {
        code: 'import { something } from "@actual-app/core";',
        filename: 'packages/api/src/index.ts',
      },
      // @actual-app/api can import @actual-app/crdt (declared dep)
      {
        code: 'import { something } from "@actual-app/crdt";',
        filename: 'packages/api/src/index.ts',
      },
      // require() with declared dep is allowed
      {
        code: 'const core = require("@actual-app/core");',
        filename: 'packages/desktop-client/src/test.js',
      },
    ],
    invalid: [
      // @actual-app/components has no internal deps — cannot import @actual-app/core
      {
        code: 'import { something } from "@actual-app/core";',
        filename: 'packages/component-library/src/Button.tsx',
        errors: [
          {
            messageId: 'noCrossPackageImport',
            data: {
              currentPackage: '@actual-app/components',
              importedPackage: '@actual-app/core',
            },
          },
        ],
      },
      // @actual-app/components cannot import @actual-app/web
      {
        code: 'import { Page } from "@actual-app/web";',
        filename: 'packages/component-library/src/Button.tsx',
        errors: [
          {
            messageId: 'noCrossPackageImport',
            data: {
              currentPackage: '@actual-app/components',
              importedPackage: '@actual-app/web',
            },
          },
        ],
      },
      // @actual-app/core cannot import @actual-app/web
      {
        code: 'import { Component } from "@actual-app/web";',
        filename: 'packages/loot-core/src/server/main.ts',
        errors: [
          {
            messageId: 'noCrossPackageImport',
            data: {
              currentPackage: '@actual-app/core',
              importedPackage: '@actual-app/web',
            },
          },
        ],
      },
      // @actual-app/core cannot import @actual-app/components
      {
        code: 'import { Button } from "@actual-app/components";',
        filename: 'packages/loot-core/src/server/main.ts',
        errors: [
          {
            messageId: 'noCrossPackageImport',
            data: {
              currentPackage: '@actual-app/core',
              importedPackage: '@actual-app/components',
            },
          },
        ],
      },
      // require() with undeclared dep is also blocked
      {
        code: 'const web = require("@actual-app/web");',
        filename: 'packages/component-library/src/test.js',
        errors: [
          {
            messageId: 'noCrossPackageImport',
            data: {
              currentPackage: '@actual-app/components',
              importedPackage: '@actual-app/web',
            },
          },
        ],
      },
    ],
  },
  {
    parserOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
    },
  },
);
