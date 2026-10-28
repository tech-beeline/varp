cmake_minimum_required(VERSION 3.28)

# Slim Graphviz build: only the dot layout engine, no renderers, no CLI.
#
# The CMake build files live in the git tree, while the generated parsers live in
# the release archive. Both archives of the same version are fetched: the parsers
# are copied into the git tree, and the three places where Graphviz declares bison
# and flex targets are patched to use them. The build then needs only a C/C++
# compiler, make, cmake and python.
#
# With VARP_GRAPHVIZ_WASM the Emscripten toolchain is fetched and activated before
# the project languages are enabled, so the same source tree builds for WebAssembly.

include(FetchContent)

# Graphviz runs its version and table generators with the build-time Python.
find_package(Python3 COMPONENTS Interpreter REQUIRED)

option(VARP_GRAPHVIZ_WASM "Build the dot layout engine for WebAssembly" OFF)
if(VARP_GRAPHVIZ_WASM)
    include(cmake/emsdk.cmake)
endif()

project(varp-graphviz-layout LANGUAGES C CXX)

set(GRAPHVIZ_VERSION "16.1.0" CACHE STRING "Graphviz version")
set(GRAPHVIZ_GIT_ARCHIVE "https://gitlab.com/graphviz/graphviz/-/archive/${GRAPHVIZ_VERSION}/graphviz-${GRAPHVIZ_VERSION}.tar.gz" CACHE STRING "Graphviz source archive with the CMake build files")
set(GRAPHVIZ_RELEASE_ARCHIVE "https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/${GRAPHVIZ_VERSION}/graphviz-${GRAPHVIZ_VERSION}.tar.gz" CACHE STRING "Graphviz release archive with the generated parsers")
set(GRAPHVIZ_RELEASE_SHA256 "beea483ab130f456c1c3905f4f2e40778a9c493c3d73ae8012367d552d71ca84" CACHE STRING "Graphviz release archive checksum")

# SOURCE_SUBDIR points to a directory that does not exist, so MakeAvailable only
# downloads the archives: the sources are prepared before they are added.
FetchContent_Declare(graphviz
    URL ${GRAPHVIZ_GIT_ARCHIVE}
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    SOURCE_SUBDIR cmake/not-used
)
FetchContent_Declare(graphviz_release
    URL ${GRAPHVIZ_RELEASE_ARCHIVE}
    URL_HASH "SHA256=${GRAPHVIZ_RELEASE_SHA256}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    SOURCE_SUBDIR cmake/not-used
)
FetchContent_MakeAvailable(graphviz graphviz_release)

# ---------------------------------------------------------------------------
# Use the parsers shipped in the release archive instead of bison and flex
# ---------------------------------------------------------------------------

foreach(parser_file
    lib/cgraph/grammar.c
    lib/cgraph/grammar.h
    lib/cgraph/scan.c
    lib/common/htmlparse.c
    lib/common/htmlparse.h
    lib/expr/exparse.c
    lib/expr/exparse.h
)
    configure_file(
        "${graphviz_release_SOURCE_DIR}/${parser_file}"
        "${graphviz_SOURCE_DIR}/${parser_file}"
        COPYONLY
    )
endforeach()

function(replace_text path old_text new_text)
    file(READ "${path}" content)
    string(REPLACE "${old_text}" "${new_text}" content "${content}")
    file(WRITE "${path}" "${content}")
endfunction()

replace_text("${graphviz_SOURCE_DIR}/CMakeLists.txt"
    "find_package(BISON 3.0)
set_package_properties(BISON PROPERTIES TYPE REQUIRED)
find_package(FLEX)
set_package_properties(FLEX PROPERTIES TYPE REQUIRED)
" "")

replace_text("${graphviz_SOURCE_DIR}/lib/cgraph/CMakeLists.txt"
    "BISON_TARGET(Grammar \${CMAKE_CURRENT_SOURCE_DIR}/grammar.y
                     \${CMAKE_CURRENT_BINARY_DIR}/grammar.c)
FLEX_TARGET(Scan
  \${CMAKE_CURRENT_SOURCE_DIR}/scan.l
  \${CMAKE_CURRENT_BINARY_DIR}/scan.c
  COMPILE_FLAGS --case-insensitive
)
ADD_FLEX_BISON_DEPENDENCY(Scan Grammar)
" "")
replace_text("${graphviz_SOURCE_DIR}/lib/cgraph/CMakeLists.txt"
    "\${BISON_Grammar_OUTPUTS}" "grammar.c")
replace_text("${graphviz_SOURCE_DIR}/lib/cgraph/CMakeLists.txt"
    "\${FLEX_Scan_OUTPUTS}" "scan.c")

replace_text("${graphviz_SOURCE_DIR}/lib/common/CMakeLists.txt"
    "BISON_TARGET(HTMLparse \${CMAKE_CURRENT_SOURCE_DIR}/htmlparse.y
                       \${CMAKE_CURRENT_BINARY_DIR}/htmlparse.c)
" "")
replace_text("${graphviz_SOURCE_DIR}/lib/common/CMakeLists.txt"
    "\${BISON_HTMLparse_OUTPUTS}" "htmlparse.c")

replace_text("${graphviz_SOURCE_DIR}/lib/expr/CMakeLists.txt"
    "BISON_TARGET(
  Exparse
  \${CMAKE_CURRENT_SOURCE_DIR}/exparse.y
  \${CMAKE_CURRENT_BINARY_DIR}/exparse.c
  COMPILE_FLAGS \"--yacc -Wno-yacc --defines --debug --verbose\"
)
" "")
replace_text("${graphviz_SOURCE_DIR}/lib/expr/CMakeLists.txt"
    "\${BISON_Exparse_OUTPUTS}" "exparse.c")

# ---------------------------------------------------------------------------
# Graphviz: static libraries, dot layout only, no optional dependencies
# ---------------------------------------------------------------------------

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(GRAPHVIZ_CLI OFF CACHE BOOL "" FORCE)
set(ENABLE_LTDL OFF CACHE STRING "" FORCE)
set(WITH_EXPAT OFF CACHE STRING "" FORCE)
set(WITH_ZLIB OFF CACHE STRING "" FORCE)
set(WITH_SMYRNA OFF CACHE STRING "" FORCE)
set(WITH_X OFF CACHE STRING "" FORCE)
set(WITH_GTK OFF CACHE STRING "" FORCE)
set(WITH_GDK OFF CACHE STRING "" FORCE)
set(WITH_QUARTZ OFF CACHE STRING "" FORCE)
set(WITH_RSVG OFF CACHE STRING "" FORCE)
set(WITH_POPPLER OFF CACHE STRING "" FORCE)
set(WITH_GHOSTSCRIPT OFF CACHE STRING "" FORCE)
set(WITH_WEBP OFF CACHE STRING "" FORCE)
set(ENABLE_TCL OFF CACHE STRING "" FORCE)
set(ENABLE_SWIG OFF CACHE STRING "" FORCE)
set(ENABLE_SHARP OFF CACHE STRING "" FORCE)
set(ENABLE_D OFF CACHE STRING "" FORCE)
set(ENABLE_GO OFF CACHE STRING "" FORCE)
set(ENABLE_GUILE OFF CACHE STRING "" FORCE)
set(ENABLE_JAVA OFF CACHE STRING "" FORCE)
set(ENABLE_JAVASCRIPT OFF CACHE STRING "" FORCE)
set(ENABLE_LUA OFF CACHE STRING "" FORCE)
set(ENABLE_PERL OFF CACHE STRING "" FORCE)
set(ENABLE_PHP OFF CACHE STRING "" FORCE)
set(ENABLE_PYTHON OFF CACHE STRING "" FORCE)
set(ENABLE_R OFF CACHE STRING "" FORCE)
set(ENABLE_RUBY OFF CACHE STRING "" FORCE)
set(with_cxx_api OFF CACHE BOOL "" FORCE)
set(with_cxx_tests OFF CACHE BOOL "" FORCE)
set(with_ortho OFF CACHE BOOL "" FORCE)
set(with_sfdp OFF CACHE BOOL "" FORCE)
set(with_digcola OFF CACHE BOOL "" FORCE)
set(with_ipsepcola OFF CACHE BOOL "" FORCE)

if(EMSCRIPTEN)
    # Emscripten provides the math functions in its libc, so there is no libm to find.
    set(MATH_LIB "" CACHE STRING "" FORCE)
endif()

add_subdirectory("${graphviz_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/graphviz-build" EXCLUDE_FROM_ALL)

# Layout entry: DOT text in, compact JSON out. It calls the dot layout engine
# directly and reads the geometry from the cgraph attributes, so no renderer,
# xdot writer or font machinery is linked.
function(add_layout_target name)
    add_executable(${name} layout.cpp)

    target_include_directories(${name} PRIVATE
        ${CMAKE_BINARY_DIR}/graphviz-build
        ${graphviz_SOURCE_DIR}/lib
        ${graphviz_SOURCE_DIR}/lib/cgraph
        ${graphviz_SOURCE_DIR}/lib/cdt
        ${graphviz_SOURCE_DIR}/lib/common
        ${graphviz_SOURCE_DIR}/lib/gvc
        ${graphviz_SOURCE_DIR}/lib/pathplan
        ${graphviz_SOURCE_DIR}/lib/pack
        ${graphviz_SOURCE_DIR}/lib/label
    )

    target_link_libraries(${name} PRIVATE
        gvplugin_dot_layout
        dotgen
        gvc
        cgraph
        cdt
        common
        pack
        pathplan
        label
        util
    )
endfunction()

if(EMSCRIPTEN)
    # The Node and web builds share the same wasm code; only the JavaScript runtime
    # differs, so each bundle gets a glue without the other environment's branches.
    add_layout_target(graphviz-layout-node)
    add_layout_target(graphviz-layout-web)

    foreach(target graphviz-layout-node graphviz-layout-web)
        target_compile_options(${target} PRIVATE -flto -fno-exceptions -fno-rtti)
        target_link_options(${target} PRIVATE
            "--no-entry"
            "-flto"
            "-sSTRICT=1"
            "-sINVOKE_RUN=0"
            "-sDYNAMIC_EXECUTION=0"
            "-sPOLYFILL=0"
            "-sMODULARIZE=1"
            "-sEXPORT_NAME=createGraphvizLayout"
            "-sSINGLE_FILE=1"
            "-sFILESYSTEM=0"
            "-sALLOW_MEMORY_GROWTH=1"
            "-sSTACK_SIZE=8388608"
            "-sASSERTIONS=0"
            "-sEXPORTED_FUNCTIONS=_layout_json,_layout_free,_layout_last_error"
            "-sEXPORTED_RUNTIME_METHODS=ccall,UTF8ToString"
        )
    endforeach()

    target_link_options(graphviz-layout-node PRIVATE "-sENVIRONMENT=node")
    target_link_options(graphviz-layout-web PRIVATE "-sENVIRONMENT=web,worker")
    set_target_properties(graphviz-layout-node PROPERTIES OUTPUT_NAME "graphviz-layout" SUFFIX ".node.js")
    set_target_properties(graphviz-layout-web PROPERTIES OUTPUT_NAME "graphviz-layout" SUFFIX ".web.js")
else()
    add_layout_target(graphviz-layout)
endif()
