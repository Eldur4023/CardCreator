#include <osodio/osodio.hpp>
#include <filesystem>
#include <algorithm>
#include <vector>
#include <fstream>
#include <sstream>
#include <nlohmann/json.hpp>

namespace fs = std::filesystem;
using json   = nlohmann::json;

// Scans a directory and returns:
//   { "frames": [{file, ...meta}, ...], "subs": { name: <same structure>, ... } }
// Folders starting with '_' are skipped.
static json scan_dir(const fs::path& dir) {
    json result = json::object();
    result["frames"] = json::array();
    result["subs"]   = json::object();

    json meta = json::object();
    fs::path metaPath = dir / "frames.json";
    if (fs::exists(metaPath)) {
        try {
            std::ifstream f(metaPath);
            std::string s((std::istreambuf_iterator<char>(f)), {});
            meta = json::parse(s);
        } catch (...) {}
    }

    std::vector<fs::directory_entry> entries(fs::directory_iterator(dir), {});
    std::sort(entries.begin(), entries.end());

    for (auto& entry : entries) {
        std::string name = entry.path().filename().string();
        if (!name.empty() && name[0] == '_') continue;

        if (entry.is_directory()) {
            result["subs"][name] = scan_dir(entry.path());
        } else if (entry.is_regular_file()) {
            auto ext = entry.path().extension().string();
            if (ext != ".png" && ext != ".jpg" && ext != ".svg" && ext != ".webp") continue;

            json fileObj = json::object();
            fileObj["file"] = name;
            if (meta.contains(name) && meta[name].is_object()) {
                for (auto& [k, v] : meta[name].items())
                    fileObj[k] = v;
            }
            result["frames"].push_back(fileObj);
        }
    }

    return result;
}

int main() {
    osodio::App app;

    app.use(osodio::logger());
    app.use(osodio::cors());

    // Frame browser API
    // Response: { Category: { Subcategory: { frames: [...], subs: { ... } } } }
    app.get("/api/frames", [](osodio::Request&, osodio::Response& res) {
        const std::string base = "./assets/img/frames";
        json root = json::object();

        if (fs::exists(base) && fs::is_directory(base)) {
            std::vector<fs::directory_entry> cats(fs::directory_iterator(base), {});
            std::sort(cats.begin(), cats.end());

            for (auto& cat : cats) {
                if (!cat.is_directory()) continue;
                std::string catName = cat.path().filename().string();
                if (!catName.empty() && catName[0] == '_') continue;

                root[catName] = json::object();

                std::vector<fs::directory_entry> subs(fs::directory_iterator(cat.path()), {});
                std::sort(subs.begin(), subs.end());

                for (auto& sub : subs) {
                    if (!sub.is_directory()) continue;
                    std::string subName = sub.path().filename().string();
                    if (!subName.empty() && subName[0] == '_') continue;

                    root[catName][subName] = scan_dir(sub.path());
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
