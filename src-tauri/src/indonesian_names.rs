//! Local name bank shared by all service signup adapters. These are generated
//! display names, not identities fetched from real people's profiles.
const FIRST: [[&str; 16]; 2] = [
    ["Aditya", "Bagas", "Bima", "Damar", "Dimas", "Eko", "Fajar", "Galih",
     "Gilang", "Hendra", "Joko", "Raka", "Rizky", "Surya", "Wahyu", "Yoga"],
    ["Anisa", "Ayu", "Citra", "Dewi", "Dian", "Fitri", "Intan", "Kartika",
     "Laras", "Maya", "Nadia", "Putri", "Ratna", "Rina", "Sari", "Wulan"],
];
const SECOND: [[&str; 16]; 2] = [
    ["Pratama", "Saputra", "Nugraha", "Permana", "Santoso", "Wijaya", "Setiawan", "Kurniawan",
     "Prasetyo", "Wibowo", "Firmansyah", "Ramadhan", "Maulana", "Hakim", "Hidayat", "Pamungkas"],
    ["Lestari", "Pertiwi", "Anggraini", "Wulandari", "Maharani", "Permatasari", "Kusuma", "Safitri",
     "Utami", "Rahmawati", "Puspita", "Kartikasari", "Handayani", "Nirmala", "Anjani", "Melati"],
];

fn from_entropy(bytes: &[u8; 16]) -> String {
    let group = (bytes[0] & 1) as usize;
    format!("{} {}", FIRST[group][(bytes[1] & 15) as usize], SECOND[group][(bytes[2] & 15) as usize])
}

pub fn random_name() -> String {
    from_entropy(uuid::Uuid::new_v4().as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn entire_bank_has_distinct_bounded_form_safe_names() {
        let mut names = std::collections::HashSet::new();
        for group in 0..2 {
            for first in 0..16 {
                for second in 0..16 {
                    let mut bytes = [0; 16];
                    bytes[0] = group; bytes[1] = first; bytes[2] = second;
                    let name = from_entropy(&bytes);
                    assert!(name.len() <= 100);
                    assert_eq!(name.split_whitespace().count(), 2);
                    assert!(name.chars().all(|c| c.is_alphabetic() || c == ' '));
                    assert!(names.insert(name));
                }
            }
        }
        assert_eq!(names.len(), 512);
    }
}
