const core = require('@actions/core');
const {DefaultArtifactClient} = require('@actions/artifact')
const fs = require('fs');
const path = require('path');

const workspaceDir = process.env.GITHUB_WORKSPACE;

async function post() {
    // Report generation is now handled by veracode-github-app
    // No artifacts to collect or upload
    core.info('Post-action: report generation handled by veracode-github-app');
}

post();