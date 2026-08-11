/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 219:
/***/ ((module) => {

module.exports = eval("require")("@actions/artifact");


/***/ }),

/***/ 580:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 896:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

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
const {DefaultArtifactClient} = __nccwpck_require__(219)
const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);

const workspaceDir = process.env.GITHUB_WORKSPACE;

async function post() {
    let artifactFiles = [];

    const reportFilename = 'sca-fix-report.md';
    const artifactFilePath = path.join(workspaceDir, 'source-code', reportFilename);
    if (fs.existsSync(artifactFilePath)) {
        artifactFiles.push(artifactFilePath);
    } else {
      core.info(`${reportFilename} not found. Not included in artifact list.`);
    }

    const statusFilename = 'sca-fix-status';
    const statusFilePath = path.join(workspaceDir, 'source-code', statusFilename);
    if (fs.existsSync(statusFilePath)) {
        artifactFiles.push(statusFilePath);
    } else {
        core.info(`${statusFilename} not found. Not included in artifact list.`);
    }

    if (artifactFiles.length > 0) {
        const artifactFilePathDir = path.join(workspaceDir, 'source-code');
        core.info('== Start upload ==');
        const artifactClient = new DefaultArtifactClient();
        const uploadResponse = await artifactClient.uploadArtifact(
            'fix-for-sca-artifacts',
            artifactFiles,
            artifactFilePathDir,
            { continueOnError: false }
        );
        core.info('== End upload ==');
    } else {
        core.info('No file to upload.')
    }
}

post();
module.exports = __webpack_exports__;
/******/ })()
;