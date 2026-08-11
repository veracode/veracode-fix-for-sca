/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 654:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const os = __nccwpck_require__(857);
const core = __nccwpck_require__(580);
const exec = __nccwpck_require__(342);

async function runFixSca(workspaceDir, actionPath, fixScaParams, githubContext) {
  try {
    const projectRootDir = '';
    const projectPath = path.join(workspaceDir, 'source-code', projectRootDir);

    core.info(`Project path: ${projectPath}`);

    // Set up environment for veracode CLI
    const isWindows = process.platform === 'win32';
    const binaryName = isWindows ? 'veracode.exe' : 'veracode';
    const veracodeBinary = path.join(`${process.env.CLI_PATH}`, binaryName);

    core.info(`Veracode binary: ${veracodeBinary}`);
    core.info(`Binary exists: ${fs.existsSync(veracodeBinary)}`);

    // Find SCA results file
    const artifactDir = path.join(workspaceDir, 'veracode_artifact_directory');
    let scaResultsPath = null;

    // Try different possible paths for scaResults.json
    const possiblePaths = [
      path.join(artifactDir, 'Veracode Agent Based SCA Results', 'scaResults.json'),
      path.join(artifactDir, 'scaResults.json'),
      // Also check for any json file in the artifact directory
    ];

    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        scaResultsPath = possiblePath;
        core.info(`Found SCA results at: ${scaResultsPath}`);
        break;
      }
    }

    // If still not found, list directory contents for debugging
    if (!scaResultsPath) {
      core.warning(`SCA results not found. Listing artifact directory contents:`);
      const listDir = (dir, prefix = '') => {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          files.forEach(file => {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            core.info(`${prefix}${file}${stat.isDirectory() ? '/' : ''}`);
            if (stat.isDirectory() && prefix.length < 20) {
              listDir(fullPath, prefix + '  ');
            }
          });
        }
      };
      listDir(artifactDir);

      // Try to find any json file
      const findJsonFiles = (dir) => {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            if (file.endsWith('.json')) {
              return path.join(dir, file);
            }
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
              const found = findJsonFiles(fullPath);
              if (found) return found;
            }
          }
        }
        return null;
      };

      scaResultsPath = findJsonFiles(artifactDir);
      if (scaResultsPath) {
        core.info(`Using found JSON file: ${scaResultsPath}`);
      } else {
        throw new Error(`Could not find SCA results file in ${artifactDir}`);
      }
    }

    // Build command arguments
    const args = [
      'fix',
      'sca',
      projectPath,
      '--results',
      scaResultsPath,
      '--async',
      '--verbose',  // Add verbose mode to capture job ID
    ];

    // Conditionally add --transitive flag (default: true)
    const fixTransitive = core.getInput('fix-transitive');
    if (fixTransitive?.toLowerCase() !== 'false') {
      args.push('--transitive');
    }

    if (fixScaParams && fixScaParams.trim() && fixScaParams !== 'SCA-*') {
      core.info(`Fix SCA params: ${fixScaParams}`);
      args.push('-i', fixScaParams);
    }

    // Run veracode fix sca command with async mode
    core.info(`Running: ${veracodeBinary} ${args.join(' ')}`);

    let cliOutput = '';
    let jobId = null;

    // Pass GitHub context via environment variables (safe metadata only, no tokens)
    const env = { ...process.env };
    if (githubContext && githubContext.repository) {
      env.GITHUB_REPOSITORY = githubContext.repository.full_name;
      env.GITHUB_REPOSITORY_OWNER = githubContext.repository.owner;
      env.GITHUB_REPOSITORY_NAME = githubContext.repository.name;
      env.GITHUB_REF_NAME = githubContext.repository.branch;
      if (githubContext.issue_number) {
        env.GITHUB_ISSUE_NUMBER = githubContext.issue_number.toString();
      }
      if (githubContext.run_id) {
        env.GITHUB_RUN_ID = githubContext.run_id.toString();
      }
    }

    await exec.exec(veracodeBinary, args, {
      env: env,
      listeners: {
        stdout: (data) => {
          cliOutput += data.toString();
          core.info(data.toString());
        },
        stderr: (data) => {
          cliOutput += data.toString();
          core.warning(data.toString());
        }
      }
    });

    // Parse job_id from CLI output (async mode returns "Job ID: <uuid>")
    const jobIdPattern = /Job\s+ID:\s+([a-f0-9\-]+)/i;
    const match = cliOutput.match(jobIdPattern);

    if (match && match[1]) {
      jobId = match[1];
      core.info(`✓ Captured Fix SCA Job ID: ${jobId}`);
      core.setOutput('fix-job-id', jobId);
    } else {
      core.warning('Could not parse job ID from CLI output');
      // Log last 500 chars of output for debugging
      const outputTail = cliOutput.slice(-500);
      core.info(`Last output: ${outputTail}`);
    }

    // Check for changes in the repository
    let hasChanges = false;
    let gitDiffOutput = '';

    try {
      await exec.exec('git', ['diff', '--name-only', 'HEAD'], {
        cwd: projectPath,
        listeners: {
          stdout: (data) => {
            gitDiffOutput += data.toString();
          }
        }
      });

      if (gitDiffOutput.trim().length > 0) {
        hasChanges = true;
      }
    } catch (error) {
      core.warning(`Failed to check git diff: ${error.message}`);
    }

    if (!hasChanges) {
      core.info('No changes to existing files detected. Skipping branch creation and PR.');
      core.setOutput('run-next-step', 'false');
      return { hasChanges: false };
    }

    // Show git diff
    core.info('----- Git diff -----');
    try {
      await exec.exec('git', ['--no-pager', 'diff'], {
        cwd: projectPath
      });
    } catch (error) {
      core.warning(`Failed to show git diff: ${error.message}`);
    }

    core.setOutput('run-next-step', 'true');
    return { hasChanges: true };
  } catch (error) {
    throw new Error(`Failed to run Fix for SCA: ${error.message}`);
  }
}

module.exports = runFixSca;


/***/ }),

/***/ 682:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const os = __nccwpck_require__(857);
const core = __nccwpck_require__(580);
const exec = __nccwpck_require__(342);

async function setupAstGrep(actionPath) {
  try {
    const isWindows = process.platform === 'win32';
    
    // Determine extraction directory based on platform
    let extractDir;
    let binaryName;
    let binaryPath;
    let fileName;

    if (isWindows) {
      // For Windows, extract to a temp directory and add to PATH via core.addPath
      extractDir = path.join(os.tmpdir(), 'ast-grep');
      binaryName = 'ast-grep.exe';
      binaryPath = path.join(extractDir, binaryName);
      fileName = 'app-x86_64-pc-windows-msvc.zip';
    } else {
      // For Linux systems
      extractDir = '/usr/local/bin';
      binaryName = 'ast-grep';
      binaryPath = path.join(extractDir, binaryName);
      fileName = 'app-x86_64-unknown-linux-gnu.zip';
    }

    const astGrepVersion = '0.41.0';
    const astGrepZipPath = path.join(actionPath, 'ast-grep', `${astGrepVersion}` ,`${fileName}`);

    if (!fs.existsSync(astGrepZipPath)) {
      throw new Error(`ast-grep v${astGrepVersion} zip file not found at ${astGrepZipPath}`);
    }

    core.info(`Extracting ast-grep v${astGrepVersion} from ${astGrepZipPath} to ${extractDir}`);

    // Create extraction directory if it doesn't exist
    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
    }

    // Extract ast-grep binary
    if (isWindows) {
      await exec.exec('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${astGrepZipPath}" -DestinationPath "${extractDir}"`]);
    } else {
      await exec.exec('unzip', ['-j', astGrepZipPath, binaryName, '-d', extractDir]);
    }

    // Verify binary exists after extraction
    if (fs.existsSync(binaryPath)) {
      // On Unix-like systems, make the binary executable
      if (!isWindows) {
        fs.chmodSync(binaryPath, 0o755);
        core.info(`ast-grep v${astGrepVersion} setup completed successfully`);
        core.info(`Binary location: ${binaryPath}`);
      } else {
        // On Windows, add the extraction directory to PATH
        core.addPath(extractDir);
        core.info(`ast-grep v${astGrepVersion} setup completed successfully (Windows)`);
        core.info(`Binary location: ${binaryPath}`);
        core.info(`Added ${extractDir} to PATH`);
      }
    } else {
      throw new Error(`ast-grep binary (${binaryName}) not found at ${binaryPath} after extraction`);
    }
  } catch (error) {
    throw new Error(`Failed to setup ast-grep: ${error.message}`);
  }
}

module.exports = setupAstGrep;


/***/ }),

/***/ 580:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 342:
/***/ ((module) => {

module.exports = eval("require")("@actions/exec");


/***/ }),

/***/ 896:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 857:
/***/ ((module) => {

"use strict";
module.exports = require("os");

/***/ }),

/***/ 928:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
const core = __nccwpck_require__(580);
const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const setupAstGrep = __nccwpck_require__(682);
const runFixSca = __nccwpck_require__(654);

async function main() {
  try {
    // Get inputs
    const repository = core.getInput('repository');
    const branch = core.getInput('branch');
    const prNumber = core.getInput('pr-number');
    const fixScaParams = core.getInput('fix-sca-params');
    const fixTransitive = core.getInput('fix-transitive');

    const workspaceDir = process.env.GITHUB_WORKSPACE;
    const statusFilePath = path.join(workspaceDir, 'source-code', 'sca-fix-status');
    const actionPath = `${__dirname}/..`

    core.info('Starting Veracode Fix for SCA action...');

    // Log all inputs from action.yml
    core.info('=== ACTION INPUTS (from action.yml) ===');
    core.info(`repository: ${repository}`);
    core.info(`branch: ${branch}`);
    core.info(`pr-number: ${prNumber}`);
    core.info(`fix-sca-params: ${fixScaParams || 'NOT SET'}`);
    core.info(`fix-transitive: ${fixTransitive}`);
    core.info('=====================================');

    core.info(`GITHUB_WORKSPACE: ${workspaceDir}`);
    core.info(`CLI_PATH: ${process.env.CLI_PATH}`);

    // Setup ast-grep
    core.info('Setting up ast-grep...');
    try {
      await setupAstGrep(actionPath);
      core.info('ast-grep setup completed successfully');
    } catch (astGrepError) {
      core.error(`ast-grep setup failed: ${astGrepError.message}`);
      throw astGrepError;
    }

    // Run Fix for SCA
    core.info('Running Fix for SCA...');
    let fixScaOutput;
    try {
      const githubContext = {
        repository: {
          full_name: repository,
          owner: repository.split('/')[0],
          name: repository.split('/')[1],
          branch: branch,
        },
        issue_number: prNumber ? parseInt(prNumber) : null,
        run_id: process.env.GITHUB_RUN_ID,
      };
      fixScaOutput = await runFixSca(workspaceDir, actionPath, fixScaParams, githubContext);
      core.info('Fix for SCA completed');
    } catch (fixScaError) {
      core.error(`Fix for SCA failed: ${fixScaError.message}`);
      core.setOutput('run-next-step', 'false');
      throw fixScaError;
    }

    // In async mode, we exit here and let the backend trigger follow-up workflow
    core.info('✓ Fix for SCA job submitted to backend (async mode)');
    core.info('Workflow exiting - PR creation will be handled by follow-up workflow triggered by backend');
    core.info('Veracode Fix for SCA action completed successfully.');
  } catch (error) {
    core.setFailed(error.message);
    process.exit(1);
  }
}

main();

module.exports = __webpack_exports__;
/******/ })()
;