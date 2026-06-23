import java.io.File
import java.util.Properties
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val configuredExecutable = localProperties().getProperty("tauri.npm.executable")
        if (configuredExecutable != null) {
            runTauriCli(configuredExecutable)
            return
        }

        val executable = "npm"
        try {
            runTauriCli(executable)
        } catch (e: Exception) {
            if (Os.isFamily(Os.FAMILY_WINDOWS)) {
                // Try different Windows-specific extensions
                val fallbacks = listOf(
                    "$executable.exe",
                    "$executable.cmd",
                    "$executable.bat",
                )
                
                var lastException: Exception = e
                for (fallback in fallbacks) {
                    try {
                        runTauriCli(fallback)
                        return
                    } catch (fallbackException: Exception) {
                        lastException = fallbackException
                    }
                }
                throw lastException
            } else {
                throw e;
            }
        }
    }

    fun localProperties(): Properties {
        val properties = Properties()
        val file = File(project.rootProject.projectDir, "local.properties")
        if (file.isFile) {
            file.inputStream().use { properties.load(it) }
        }
        return properties
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = listOf("run", "--", "tauri", "android", "android-studio-script");
        val properties = localProperties()

        project.exec {
            workingDir(File(project.projectDir, rootDirRel))
            executable(executable)
            val pathParts = listOfNotNull(
                properties.getProperty("tauri.node.dir"),
                properties.getProperty("tauri.cargo.dir"),
                properties.getProperty("tauri.android.home")?.let { File(it, "platform-tools").path },
                System.getenv("PATH"),
            )
            environment("PATH", pathParts.joinToString(File.pathSeparator))
            properties.getProperty("tauri.java.home")?.let { environment("JAVA_HOME", it) }
            properties.getProperty("tauri.android.home")?.let {
                environment("ANDROID_HOME", it)
                environment("ANDROID_SDK_ROOT", it)
            }
            properties.getProperty("tauri.ndk.home")?.let {
                environment("NDK_HOME", it)
                environment("ANDROID_NDK_HOME", it)
            }
            args(args)
            if (project.logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (project.logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}
