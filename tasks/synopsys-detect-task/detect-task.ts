import task = require("azure-pipelines-task-lib/task");
import * as os from 'os'
import {IBlackduckConfiguration} from './ts/model/IBlackduckConfiguration'
import {IDetectConfiguration} from './ts/model/IDetectConfiguration'
import {ITaskConfiguration} from './ts/model/ITaskConfiguration'
import {DetectADOConstants} from './ts/DetectADOConstants'
import {IProxyInfo} from './ts/model/IProxyInfo'
import {DetectScript} from './ts/script/DetectScript';
import {PowershellDetectScript} from './ts/script/PowershellDetectScript';
import {ShellDetectScript} from './ts/script/ShellDetectScript';
import fileSystem from 'fs';
import {logger} from './ts/DetectLogger'
import {DetectScriptDownloader} from './ts/DetectScriptDownloader';
import {DetectSetup} from './ts/DetectSetup';
import {BashDetectScript} from "./ts/script/BashDetectScript";
import {PathResolver} from "./ts/PathResolver";

const osPlat: string = os.platform()

async function run() {
    logger.info('Starting Detect Task')
    try {
        const blackduckConfiguration: IBlackduckConfiguration = getBlackduckConfiguration()
        const detectConfiguration: IDetectConfiguration = getDetectConfiguration()
        const taskConfiguration: ITaskConfiguration = getTaskConfiguration()

        const detectScript: DetectScript = createScript()
        const workingDirectory = PathResolver.getWorkingDirectory() || ""
        const scriptFolder: string = PathResolver.combinePathSegments(workingDirectory, DetectADOConstants.SCRIPT_DETECT_FOLDER)

        const scriptDownloader = new DetectScriptDownloader()
        let foundError
        await scriptDownloader.downloadScript(blackduckConfiguration.proxyInfo, detectScript.getScriptName(), scriptFolder)
            .catch(error => {
                foundError = error
            })

        if (foundError) {
            logger.debug(`Ran into an issue while downloading script: ${foundError}`)
            task.setResult(task.TaskResult.Failed, `Detect run failed, there was an issue downloading the Detect script`)
            return
        }

        const detectSetup = new DetectSetup()
        const env = detectSetup.createEnvironmentWithVariables(blackduckConfiguration, detectConfiguration.detectVersion, detectConfiguration.detectFolder)
        const cleanedArguments = detectSetup.convertArgumentsToPassableValues(detectConfiguration.detectAdditionalArguments)

        const detectResult: number = await detectScript.invokeDetect(cleanedArguments, scriptFolder, env)

        logger.info('Finished running detect, updating task information')
        if (taskConfiguration.addTaskSummary) {
            logger.info('Adding task summary')
            const content = (detectResult == 0) ? 'Detect ran successfully' : `There was an issue running detect, exit code: ${detectResult}`
            const tempFile: string = Date.now().toString()
            const fullPath: string = PathResolver.combinePathSegments(__dirname, tempFile)
            fileSystem.writeFileSync(fullPath, content)
            task.addAttachment('Distributedtask.Core.Summary', 'Synopsys Detect', fullPath)
        }

        if (detectResult != 0) {
            task.setResult(task.TaskResult.Failed, `Detect run failed, received error code: ${detectResult}`)
            return
        }
    } catch (e) {
        task.setResult(task.TaskResult.Failed, `An unexpected error occurred: ${e}`)
    }
}

function createScript(): DetectScript {
    if ('win32' == osPlat) {
        logger.info('Windows detected: Running powershell script')
        return new PowershellDetectScript()
    } else if ('darwin' == osPlat) {
        logger.info('Mac detected: Running shell script')
        return new ShellDetectScript()
    }

    logger.info('Linux detected: Running bash script')
    return new BashDetectScript()
}

function getBlackduckConfiguration(): IBlackduckConfiguration {
    logger.info('Retrieving Blackduck configuration')
    const blackduckService: string = task.getInput(DetectADOConstants.BLACKDUCK_ID, true)!
    const blackduckUrl: string = task.getEndpointUrl(blackduckService, false)!
    const blackduckToken: string | undefined = task.getEndpointAuthorizationParameter(blackduckService, DetectADOConstants.BLACKDUCK_API_TOKEN, true)
    const blackduckUsername: string | undefined = task.getEndpointAuthorizationParameter(blackduckService, DetectADOConstants.BLACKDUCK_USERNAME, true)
    const blackduckPassword: string | undefined = task.getEndpointAuthorizationParameter(blackduckService, DetectADOConstants.BLACKDUCK_PASSWORD, true)

    let blackduckProxyInfo: IProxyInfo | undefined
    const blackduckProxyService: string | undefined = task.getInput(DetectADOConstants.BLACKDUCK_PROXY_ID, false)
    if (blackduckProxyService) {
        const proxyUrl: string = task.getEndpointUrl(blackduckProxyService, true)!
        const proxyUsername : string | undefined = task.getEndpointAuthorizationParameter(blackduckProxyService, DetectADOConstants.PROXY_USERNAME, true)
        const proxyPassword: string | undefined = task.getEndpointAuthorizationParameter(blackduckProxyService, DetectADOConstants.PROXY_PASSWORD, true)

        blackduckProxyInfo = {
            proxyUrl,
            proxyUsername,
            proxyPassword
        }
    }

    return {
        blackduckUrl,
        blackduckApiToken: blackduckToken,
        blackduckUsername,
        blackduckPassword,
        proxyInfo: blackduckProxyInfo
    }
}

function getDetectConfiguration(): IDetectConfiguration {
    logger.info('Retrieving Detect configuration')
    const additionalArguments: string = task.getInput(DetectADOConstants.DETECT_ARGUMENTS, false) || ''
    const detectFolder: string = task.getInput(DetectADOConstants.DETECT_FOLDER, false) || PathResolver.getToolDirectory() || 'detect'
    const detectVersion: string = task.getInput(DetectADOConstants.DETECT_VERSION, false) || 'latest'

    return {
        detectAdditionalArguments: additionalArguments,
        detectFolder,
        detectVersion
    }
}

function getTaskConfiguration(): ITaskConfiguration {
    logger.info('Retrieving Task configuration')
    const addTask: boolean = task.getBoolInput(DetectADOConstants.ADD_TASK_SUMMARY, false)

    return {
        addTaskSummary: addTask
    }
}

run()
