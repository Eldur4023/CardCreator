#include <osodio/osodio.hpp>
#include <filesystem>
#include <algorithm>
#include <vector>
#include <fstream>
#include <sstream>
#include <nlohmann/json.hpp>

namespace fs = std::filesystem;
using json   = nlohmann::json;

int main() {
    osodio::App app;

    app.use(osodio::logger());
    app.use(osodio::cors());

    // Frame browser API
    // Response: { Category: { Subcategory: [ { file, ...meta }, ... ] } }
    app.get("/api/frames", [](osodio::Request&, osodio::Response& res) {
        const std::string base = "./assets/img/frames";
        json root = json::object();

        if (fs::exists(base) && fs::is_directory(base)) {
            std::vector<fs::directory_entry> cats(fs::directory_iterator(base), {});
            std::sort(cats.begin(), cats.end());

            for (auto& cat : cats) {
                if (!cat.is_directory()) continue;
                std::string catName = cat.path().filename().string();
                root[catName] = json::object();

                std::vector<fs::directory_entry> subs(fs::directory_iterator(cat.path()), {});
                std::sort(subs.begin(), subs.end());

                for (auto& sub : subs) {
                    if (!sub.is_directory()) continue;
                    std::string subName = sub.path().filename().string();

                    // Load frames.json if present
                    json meta = json::object();
                    fs::path metaPath = sub.path() / "frames.json";
                    if (fs::exists(metaPath)) {
                        try {
                            std::ifstream f(metaPath);
                            std::string s((std::istreambuf_iterator<char>(f)), {});
                            meta = json::parse(s);
                        } catch (...) {}
                    }

                    json files = json::array();
                    std::vector<fs::directory_entry> entries(fs::directory_iterator(sub.path()), {});
                    std::sort(entries.begin(), entries.end());

                    for (auto& entry : entries) {
                        if (!entry.is_regular_file()) continue;
                        auto ext = entry.path().extension().string();
                        if (ext != ".png" && ext != ".jpg" && ext != ".svg" && ext != ".webp") continue;

                        std::string fname = entry.path().filename().string();
                        json fileObj = json::object();
                        fileObj["file"] = fname;

                        // Merge per-file metadata if present
                        if (meta.contains(fname) && meta[fname].is_object()) {
                            for (auto& [k, v] : meta[fname].items())
                                fileObj[k] = v;
                        }

                        files.push_back(fileObj);
                    }
                    root[catName][subName] = files;
                }
            }
        }

        res.json(root);
    });

    app.serve_static("/img/frames",      "./assets/img/frames");
    app.serve_static("/img/manaSymbols", "./assets/img/manaSymbols");
    app.serve_static("/img",             "./assets/img");
    app.serve_static("/fonts",           "./assets/fonts");

    // App static files and SPA fallback
    app.set_templates("./public");
    app.serve_static("/", "./public", true);

    app.run(3000);
}
