#include <osodio/osodio.hpp>

int main() {
    osodio::App app;

    app.use(osodio::logger());
    app.use(osodio::cors());

    // Pack scripts use /img/frames/... — map both /img/frames and /img to assets/img
    app.serve_static("/img/frames",      "./assets/img");
    app.serve_static("/img/manaSymbols", "./assets/img/manaSymbols");
    app.serve_static("/img",             "./assets/img");
    app.serve_static("/fonts",           "./assets/fonts");
    app.serve_static("/js/frames",       "./assets/frames");

    // App static files and SPA fallback
    app.set_templates("./public");
    app.serve_static("/", "./public", true);

    app.run(3000);
}
