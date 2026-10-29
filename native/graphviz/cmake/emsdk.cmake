include(FetchContent)

set(EMSDK_VERSION "4.0.23" CACHE STRING "Emscripten version installed by emsdk")

# emsdk is fetched and activated before any language is enabled, so the Emscripten
# toolchain file is in place when enable_language() runs. Activation writes
# <emsdk>/.emscripten, which emcc finds on its own from the upstream layout, so the
# build does not depend on environment variables.
FetchContent_Declare(emsdk
    GIT_REPOSITORY https://github.com/emscripten-core/emsdk.git
    GIT_TAG ${EMSDK_VERSION}
    GIT_SHALLOW TRUE
    SOURCE_SUBDIR cmake/not-used
)
FetchContent_MakeAvailable(emsdk)

execute_process(
    COMMAND "${Python3_EXECUTABLE}" "${emsdk_SOURCE_DIR}/emsdk.py" install ${EMSDK_VERSION}
    RESULT_VARIABLE emsdk_install
)
if(NOT emsdk_install EQUAL 0)
    message(FATAL_ERROR "emsdk install ${EMSDK_VERSION} failed with ${emsdk_install}")
endif()

execute_process(
    COMMAND "${Python3_EXECUTABLE}" "${emsdk_SOURCE_DIR}/emsdk.py" activate ${EMSDK_VERSION}
    RESULT_VARIABLE emsdk_activate
)
if(NOT emsdk_activate EQUAL 0)
    message(FATAL_ERROR "emsdk activate ${EMSDK_VERSION} failed with ${emsdk_activate}")
endif()

# On Windows emcc.bat starts the compiler driver with %EMSDK_PYTHON% and falls
# back to a bare "python" from PATH, so the interpreter installed by emsdk is taken
# from the generated config and exported for the toolchain checks and the build.
# Other platforms run emcc with the system python3 and have no PYTHON entry.
if(WIN32)
    file(STRINGS "${emsdk_SOURCE_DIR}/.emscripten" emsdk_config)
    foreach(line IN LISTS emsdk_config)
        if(line MATCHES "^PYTHON = emsdk_path \\+ '([^']+)'")
            set(EMSDK_PYTHON "${emsdk_SOURCE_DIR}${CMAKE_MATCH_1}" CACHE FILEPATH "Python used by emcc")
        endif()
    endforeach()
    if(NOT EMSDK_PYTHON)
        message(FATAL_ERROR "PYTHON is not defined in ${emsdk_SOURCE_DIR}/.emscripten")
    endif()
    set(ENV{EMSDK_PYTHON} "${EMSDK_PYTHON}")
endif()

set(CMAKE_TOOLCHAIN_FILE
    "${emsdk_SOURCE_DIR}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake"
    CACHE FILEPATH "Emscripten toolchain" FORCE
)
