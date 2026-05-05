cmake_minimum_required(VERSION 3.20)
project(proxys CXX C)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenSSL REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(NGHTTP2 REQUIRED libnghttp2)

set(OSODIO_SOURCES
    src/app.cpp
    src/router.cpp
    src/core/event_loop.cpp
    src/core/io_uring_loop.cpp
    src/core/tcp_server.cpp
    src/http/http_parser.cpp
    src/http/http_connection.cpp
    src/http/http2_connection.cpp
    third_party/llhttp/src/api.c
    third_party/llhttp/src/http.c
    third_party/llhttp/src/llhttp.c
    third_party/simdjson.cpp
)

add_executable(proxys app/main.cpp ${OSODIO_SOURCES})

target_include_directories(proxys PRIVATE
    include
    third_party
    third_party/llhttp/include
    ${NGHTTP2_INCLUDE_DIRS}
)

target_link_libraries(proxys PRIVATE
    OpenSSL::SSL
    OpenSSL::Crypto
    ${NGHTTP2_LIBRARIES}
)

target_compile_options(proxys PRIVATE -O2)
