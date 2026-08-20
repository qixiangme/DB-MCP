plugins {
    kotlin("jvm") version "2.1.21"
    application
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(17)
    }
}

repositories {
    mavenCentral()
}

val ktorVersion = "3.1.2"

dependencies {
    implementation("io.ktor:ktor-server-core:$ktorVersion")
    implementation("io.ktor:ktor-server-netty:$ktorVersion")
    implementation("io.ktor:ktor-server-sse:$ktorVersion")
    implementation("io.ktor:ktor-server-content-negotiation:$ktorVersion")
    implementation("io.ktor:ktor-serialization-jackson:$ktorVersion")
    implementation("ch.qos.logback:logback-classic:1.5.16")

    // Core (transport-agnostic) Kotlin MCP SDK -- same version family the baseline's
    // spring-ai-starter-mcp-server-webmvc pulls in transitively. No Spring-specific
    // transport module is used; the SSE transport is implemented directly against
    // Ktor in internal/transport.
    implementation("io.modelcontextprotocol.sdk:mcp:0.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-reactor:1.9.0")

    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.18.2")
    implementation("org.jetbrains.kotlin:kotlin-reflect")

    implementation("org.postgresql:postgresql:42.7.4")
    implementation("com.zaxxer:HikariCP:5.1.0")

    implementation("com.pgvector:pgvector:0.1.6")

    testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
    testImplementation("io.ktor:ktor-server-test-host:$ktorVersion")
}

kotlin {
    compilerOptions {
        freeCompilerArgs.add("-Xjsr305=strict")
    }
}

application {
    mainClass.set("com.riwonace.mcpktor.ApplicationKt")
}

tasks.withType<Test> {
    useJUnitPlatform()
}
