const fs = require('fs');
const path = require('path');
const os = require('os');
const core = require('@actions/core');
const exec = require('@actions/exec');

async function runFixSca(workspaceDir, actionPath, fixScaParams) {
  try {
    const projectRootDir = '';
    const projectPath = path.join(workspaceDir, 'source-code', projectRootDir);

    // Set up environment for veracode CLI
    const veracodeBinary =  path.join(`${process.env.CLI_PATH}`, 'veracode'); 
    // Build command arguments
    const args = [
      'fix',
      'sca',
      projectPath,
      '--results', path.join(workspaceDir, 'veracode_artifact_directory/Veracode Agent Based SCA Results', 'scaResults.json'),
      '--transitive',
      '--async', 
      '--decouple', 'true'
    ];

    if (fixScaParams && fixScaParams.trim() && fixScaParams !== 'SCA-*') {
      core.info(`Fix SCA params: ${fixScaParams}`);
      args.push('-i', fixScaParams);
    }

    // Run veracode fix sca command
    core.info(`Running: ${veracodeBinary} ${args.join(' ')}`);
    await exec.exec(veracodeBinary, args, {
      env: { ...process.env }
    });

    // If exists, upload the sca-fix-report.md as an artifact
    const reportFilename = 'sca-fix-report.md';
    const artifactFilePath = path.join(workspaceDir, 'source-code', reportFilename);
    const artifactFilePathDir = path.join(workspaceDir, 'source-code');

    if (fs.existsSync(artifactFilePath)) {
      core.info('== Start upload ==')
      const artifactClient = new DefaultArtifactClient();
      const uploadResponse = await artifactClient.uploadArtifact(
        'sca-fix-report',
        [artifactFilePath],
        artifactFilePathDir,
        { continueOnError: false }
      );
      core.info('== End upload ==')
      core.info(`Artifact uploaded successfully: ${uploadResponse.artifactName}`);
    } else {
      core.info(`${reportFilename} not found. Skipping artifact upload.`);
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

    return { hasChanges: true };
  } catch (error) {
    throw new Error(`Failed to run Fix for SCA: ${error.message}`);
  }
}

module.exports = runFixSca;
