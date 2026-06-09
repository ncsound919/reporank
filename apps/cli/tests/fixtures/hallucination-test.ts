// Permanent test fixture for the hallucination detector.
// Contains intentional phantom imports to verify detection in regression
// tests. The verify command should:
//  - flag the missing-dependency imports
//  - flag the typo imports (expres→express, etc.)
//  - flag the known-phantom imports (cv2, sklearn)
//  - ignore the builtin imports (fs, os)
//  - ignore the relative imports (./verify)
//  - ignore the workspace imports (@reporank/...)

import { foo } from "phantom-pkg-that-doesnt-exist";
import { bar } from "nonexistent-llm-package";
import { baz } from "fake-ml-library";
import { qux } from "@scope/missing-workspace-pkg";
import { built } from "fs";
import { rel } from "./verify";
import { cv2 } from "cv2";
import { sklearn } from "sklearn";
import { express } from "expres";
import { lod } from "lodsh";
import os from "node:os";
import * as fs from "fs";
