const fs = require('fs');
const path = require('path');
const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const { DefaultArtifactClient } = require('@actions/artifact');

async function uploadPrComment(workspaceDir, repository, prNumber, githubToken, githubApiUrl) {
  try {
    const resultsFilePath = path.join(workspaceDir, 'github_fix_pr_post_response.json');

    if (!fs.existsSync(resultsFilePath)) {
      core.warning(`Fix PR response file not found at ${resultsFilePath}. Skipping comment post.`);
      return;
    }

    const prResponse = fs.readFileSync(resultsFilePath, 'utf8');

    // Generate the comment body
    let commentBody = generateDefaultCommentBody(prResponse);    

    if (!commentBody || commentBody.trim().length === 0) {
      core.warning('Comment body is empty. Skipping comment post.');
      return;
    }

    core.info(`Upload comment to PR #${prNumber} as an artifact...`);

    // Parse repository string (format: owner/repo)
    const [owner, repo] = repository.split('/');
    if (!owner || !repo) {
      throw new Error(`Invalid repository format. Expected 'owner/repo', got '${repository}'`);
    }

    // Upload PR comment data as artifact
    const artifactData = {
      repository_owner: owner,
      repository_name: repo,
      issue_number: parseInt(prNumber),
      body: commentBody
    };

    const artifactDir = path.join(workspaceDir, 'veracode_artifact_directory');
    fs.mkdirSync(artifactDir, { recursive: true });
    const artifactFilePath = path.join(artifactDir, 'veracode-cli.pr-comment.json');
    fs.writeFileSync(artifactFilePath, JSON.stringify(artifactData, null, 2));

    core.info('== Start upload ==')
    const artifactClient = new DefaultArtifactClient();
    const artifactName = 'veracode-cli-pr-comment-json';
    const uploadResponse = await artifactClient.uploadArtifact(
      artifactName,
      [artifactFilePath],
      workspaceDir,
      { continueOnError: false }
    );
    core.info('== End upload ==')

    core.info(`Artifact uploaded successfully: ${uploadResponse?.artifactName || artifactName}`);
  } catch (artifactError) {
    core.warning(`Failed to upload artifact: ${artifactError.message}`);
    // Don't fail the action if uploading fails
  }
}

function generateDefaultCommentBody(prResponseStr) {
  try {
    const prResponse = typeof prResponseStr === 'string' ? JSON.parse(prResponseStr) : prResponseStr;
    return `## Veracode Fix for SCA - Pull Request Created
**PR:** ${prResponse.html_url || 'N/A'}

This PR contains updates for vulnerable dependencies.

### Next Steps:
1. Review the changes in the Fix for SCA PR.
2. Verify that tests pass.
3. Merge the PR to apply the dependency updates.
4. Re-run the SCA scan to verify the fixes.`;
  } catch (error) {
    return 'A pull request has been created with automated fixes for Veracode SCA vulnerabilities. Please review the changes.';
  }
}

module.exports = uploadPrComment;
