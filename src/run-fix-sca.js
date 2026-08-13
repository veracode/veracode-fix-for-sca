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
          // CLI output goes directly to GitHub Actions console
          // Don't re-log via core.info to avoid duplication
        },
        stderr: (data) => {
          cliOutput += data.toString();
          // CLI errors go directly to GitHub Actions console
          // Don't re-log via core.warning to avoid duplication
        }
      }
    });

    // Parse job IDs and conversation IDs from CLI output
    // Job IDs: "jobID":"<uuid>" or "jobIDs":["<uuid>", ...]
    // Conversation IDs: X-Conversation-Id=["<uuid>"] from HTTP headers
    const uuidPattern = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g;
    const allUuids = cliOutput.match(uuidPattern) || [];

    // Extract X-Conversation-Id (appears in HTTP response headers)
    const conversationIdMatch = cliOutput.match(/X-Conversation-Id=\["([a-f0-9\-]+)"\]/);
    const conversationId = conversationIdMatch ? conversationIdMatch[1] : null;

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

    // Fire-and-forget mode: if GitHub context present, skip local PR creation
    // Backend will handle PR creation via triggered workflow
    if (githubContext && githubContext.repository) {
      core.info('✓ Fire-and-forget mode detected: backend will handle PR creation');
      core.setOutput('run-next-step', 'false');
      return { hasChanges: false, fireAndForget: true };
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
