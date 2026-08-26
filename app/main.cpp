#include <osodio/osodio.hpp>
#include <filesystem>
#include <algorithm>
#include <vector>
#include <fstream>
#include <sstream>
#include <nlohmann/json.hpp>
#include <chrono>

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

static const std::string LIBRARY_PATH = "./data/library.json";
static const std::string DECKS_PATH   = "./data/decks.json";

static json file_read_array(const std::string& path) {
    if (!fs::exists(path)) return json::array();
    try {
        std::ifstream f(path);
        std::string s((std::istreambuf_iterator<char>(f)), {});
        auto j = json::parse(s);
        return j.is_array() ? j : json::array();
    } catch (...) { return json::array(); }
}

static void file_write(const std::string& path, const json& arr) {
    fs::create_directories("./data");
    std::ofstream f(path);
    f << arr.dump();
}

static json library_read()               { return file_read_array(LIBRARY_PATH); }
static void library_write(const json& a) { file_write(LIBRARY_PATH, a); }
static json decks_read()                 { return file_read_array(DECKS_PATH); }
static void decks_write(const json& a)   { file_write(DECKS_PATH, a); }

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

    // Library API
    app.get("/api/library", [](osodio::Request&, osodio::Response& res) {
        res.json(library_read());
    });

    app.post("/api/library", [](osodio::Request& req, osodio::Response& res) {
        try {
            json entry = json::parse(req.body);
            auto cards = library_read();
            cards.insert(cards.begin(), entry);
            library_write(cards);
            res.json(entry);
        } catch (...) {
            res.status(400).json({ {"error", "invalid json"} });
        }
    });

    app.patch("/api/library/:id", [](osodio::Request& req, osodio::Response& res) {
        const std::string id = req.params.count("id") ? req.params.at("id") : "";
        try {
            json patch = json::parse(req.body);
            auto cards = library_read();
            bool found = false;
            for (auto& c : cards) {
                if (c.value("id","") != id) continue;
                if (patch.contains("name")) c["name"] = patch["name"];
                found = true;
                break;
            }
            if (!found) { res.status(404).json({{"error","not found"}}); return; }
            library_write(cards);
            res.json({{"ok", true}});
        } catch (...) {
            res.status(400).json({{"error","invalid json"}});
        }
    });

    app.del("/api/library/:id", [](osodio::Request& req, osodio::Response& res) {
        const std::string id = req.params.count("id") ? req.params.at("id") : "";
        auto cards = library_read();
        auto it = std::remove_if(cards.begin(), cards.end(),
            [&](const json& c){ return c.value("id", "") == id; });
        cards.erase(it, cards.end());
        library_write(cards);
        res.json({ {"ok", true} });
    });

    // Decks API
    app.get("/api/decks", [](osodio::Request&, osodio::Response& res) {
        res.json(decks_read());
    });

    app.post("/api/decks", [](osodio::Request& req, osodio::Response& res) {
        try {
            json body  = json::parse(req.body);
            std::string name = body.value("name", "");
            if (name.empty()) { res.status(400).json({{"error","name required"}}); return; }
            json deck  = {
                {"id",        std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(
                                  std::chrono::system_clock::now().time_since_epoch()).count())},
                {"name",      name},
                {"createdAt", std::chrono::duration_cast<std::chrono::milliseconds>(
                                  std::chrono::system_clock::now().time_since_epoch()).count()},
                {"cards",     json::array()}
            };
            auto decks = decks_read();
            decks.push_back(deck);
            decks_write(decks);
            res.json(deck);
        } catch (...) {
            res.status(400).json({{"error","invalid json"}});
        }
    });

    app.del("/api/decks/:id", [](osodio::Request& req, osodio::Response& res) {
        const std::string id = req.params.count("id") ? req.params.at("id") : "";
        auto decks = decks_read();
        auto it = std::remove_if(decks.begin(), decks.end(),
            [&](const json& d){ return d.value("id","") == id; });
        decks.erase(it, decks.end());
        decks_write(decks);
        res.json({{"ok", true}});
    });

    // PUT /api/decks/:id/cards/:cardId  → add card to deck
    app.put("/api/decks/:id/cards/:cardId", [](osodio::Request& req, osodio::Response& res) {
        const std::string deckId   = req.params.count("id")     ? req.params.at("id")     : "";
        const std::string cardId   = req.params.count("cardId") ? req.params.at("cardId") : "";
        auto decks = decks_read();
        bool found = false;
        for (auto& d : decks) {
            if (d.value("id","") != deckId) continue;
            auto& cards = d["cards"];
            bool already = false;
            for (auto& c : cards) if (c.get<std::string>() == cardId) { already = true; break; }
            if (!already) cards.push_back(cardId);
            found = true;
            break;
        }
        if (!found) { res.status(404).json({{"error","deck not found"}}); return; }
        decks_write(decks);
        res.json({{"ok", true}});
    });

    // DELETE /api/decks/:id/cards/:cardId  → remove card from deck
    app.del("/api/decks/:id/cards/:cardId", [](osodio::Request& req, osodio::Response& res) {
        const std::string deckId = req.params.count("id")     ? req.params.at("id")     : "";
        const std::string cardId = req.params.count("cardId") ? req.params.at("cardId") : "";
        auto decks = decks_read();
        bool found = false;
        for (auto& d : decks) {
            if (d.value("id","") != deckId) continue;
            auto& cards = d["cards"];
            cards.erase(std::remove_if(cards.begin(), cards.end(),
                [&](const json& c){ return c.get<std::string>() == cardId; }), cards.end());
            found = true;
            break;
        }
        if (!found) { res.status(404).json({{"error","deck not found"}}); return; }
        decks_write(decks);
        res.json({{"ok", true}});
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
