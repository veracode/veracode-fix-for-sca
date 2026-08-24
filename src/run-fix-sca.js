const fs = require('fs');
const path = require('path');
const os = require('os');
const core = require('@actions/core');
const exec = require('@actions/exec');

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

    // Conditionally add --remote flag (default: false)
    const fixRemote = core.getInput('fix-remote');
    if (fixRemote?.toLowerCase() === 'true') {
      core.info(`remote argument appended`)
      args.push('--remote');
    }

    if (fixScaParams && fixScaParams.trim() && fixScaParams !== 'SCA-*') {
      core.info(`Fix SCA params: ${fixScaParams}`);
      args.push('-i', fixScaParams);
    }

    // Run veracode fix sca command with async mode
    core.info(`Running: ${veracodeBinary} ${args.join(' ')}`);

    let cliOutput = '';
    let jobId = null;
    let cliExitCode = 0;

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

    try {
      cliExitCode = await exec.exec(veracodeBinary, args, {
        env: env,
        listeners: {
          stdout: (data) => {
            cliOutput += data.toString();
            // CLI output goes directly to GitHub Actions console
            // Don't re-log via core.info to avoid duplication
          },
          stderr: (data) => {
            cliOutput += data.toString();
            // CLI errors go directly to GitHub Actions console
            // Don't re-log via core.warning to avoid duplication
          }
        },
        ignoreReturnCode: true,
      });
    } catch (error) {
      core.error(`[CLI_ERROR] Failed to execute veracode CLI: ${error.message}`);
      throw error;
    }

    // Check for CLI errors - if exit code is non-zero, submission likely failed
    if (cliExitCode !== 0) {
      // Extract error details from CLI output
      const errorLines = cliOutput
        .split('\n')
        .filter((line) => line.includes('ERR') || line.includes('Error'))
        .slice(-5)
        .join('\n');

      core.error(
        `[CLI_SUBMISSION_FAILED] CLI exited with code ${cliExitCode}`
      );
      core.error(`[CLI_SUBMISSION_FAILED] Recent errors:\n${errorLines}`);

      // Check for specific HTTP error codes in output
      const has500Error = cliOutput.includes('500 Internal Server Error');
      const has400Error = cliOutput.includes('400') || cliOutput.includes('Bad Request');
      const has401Error = cliOutput.includes('401') || cliOutput.includes('Unauthorized');
      const has403Error = cliOutput.includes('403') || cliOutput.includes('Forbidden');

      if (has500Error) {
        core.error(
          '[BACKEND_ERROR] Backend service returned 500 Internal Server Error'
        );
      } else if (has400Error) {
        core.error('[BACKEND_ERROR] Backend service returned 400 Bad Request');
      } else if (has401Error) {
        core.error('[BACKEND_ERROR] Backend service returned 401 Unauthorized');
      } else if (has403Error) {
        core.error('[BACKEND_ERROR] Backend service returned 403 Forbidden');
      }

      // In fire-and-forget mode, still fail if submission didn't succeed
      if (githubContext && githubContext.repository) {
        core.error(
          '[FIRE_AND_FORGET_FAILURE] Job submission failed. Backend was not reached.'
        );
        core.setOutput('run-next-step', 'false');
        throw new Error(
          `Fix SCA job submission failed with exit code ${cliExitCode}`
        );
      }

      // For polling mode, also fail
      core.setOutput('run-next-step', 'false');
      throw new Error(
        `Fix SCA job submission failed with exit code ${cliExitCode}`
      );
    }

    // Extract conversation ID from response headers (works for both modes)
    const conversationIdMatch = cliOutput.match(/X-Conversation-Id=\["([a-f0-9\-]+)"\]/);
    const conversationId = conversationIdMatch ? conversationIdMatch[1] : null;

    // Fire-and-forget mode: backend handles job polling, PR creation, etc.
    // Check this FIRST to avoid unnecessary UUID parsing for polling mode
    if (githubContext && githubContext.repository) {
      core.debug('Fire-and-forget mode: backend will handle processing');
      if (conversationId) {
        core.debug(
          `Conversation ID: ${conversationId} (use for debugging)`
        );
        core.setOutput('conversation-id', conversationId);
      }
      core.setOutput('run-next-step', 'false');
      return { hasChanges: false, fireAndForget: true };
    }

    // Polling mode: parse job ID from CLI output for manual polling by user
    // This is only used when there's NO GitHub context (manual CLI invocation)
    const uuidPattern = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g;
    const allUuids = cliOutput.match(uuidPattern) || [];

    // Job IDs: "jobID":"<uuid>" or "jobIDs":["<uuid>", ...]
    if (allUuids.length > 0) {
      // Deduplicate UUIDs and take first as job ID
      const uniqueUuids = [...new Set(allUuids)];
      jobId = uniqueUuids[0];
      core.info(`✓ Captured Fix SCA Job ID: ${jobId}`);
      core.setOutput('fix-job-id', jobId);
    } else {
      core.warning('Could not parse job ID from CLI output');
      // Log last 500 chars of output for debugging
      const outputTail = cliOutput.slice(-500);
      core.info(`Last output: ${outputTail}`);
    }

    if (conversationId) {
      core.info(`Conversation ID: ${conversationId}`);
      core.setOutput('conversation-id', conversationId);
    }

    // Check for changes in the repository (polling mode only)
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
