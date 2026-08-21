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
    implementation("io.ktor:ktor-server-content-negotiation:$ktorVersion")
    implementation("io.ktor:ktor-serialization-jackson:$ktorVersion")
    implementation("ch.qos.logback:logback-classic:1.5.16")

    // Same core (transport-agnostic) Kotlin MCP SDK mcp-server-ktor uses. Unlike the
    // server side, the SDK DOES ship a client-side SSE transport
    // (HttpClientSseClientTransport, backed by java.net.http -- no Ktor HTTP client
    // needed), so agent-app-ktor's MCP client wiring needs no custom transport code.
    implementation("io.modelcontextprotocol.sdk:mcp:0.10.0")

    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.18.2")
    implementation("org.jetbrains.kotlin:kotlin-reflect")

    testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
    testImplementation("org.mockito:mockito-core:5.14.2")
}

kotlin {
    compilerOptions {
        freeCompilerArgs.add("-Xjsr305=strict")
    }
}

application {
    mainClass.set("com.riwonace.agentktor.ApplicationKt")
}

tasks.withType<Test> {
    useJUnitPlatform()
}
