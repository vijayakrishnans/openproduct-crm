// No console window behind the editor on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    orun_work_lib::run()
}
