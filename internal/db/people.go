package db

import (
	"database/sql"
	"fmt"
	"strings"
)

type Person struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
}

func (d *DB) ListPeople() ([]Person, error) {
	rows, err := d.Conn.Query(`SELECT id,name,email FROM people ORDER BY name COLLATE NOCASE,id`)
	if err != nil {
		return nil, fmt.Errorf("list saved people: %w", err)
	}
	defer rows.Close()
	people := make([]Person, 0)
	for rows.Next() {
		var person Person
		if err := rows.Scan(&person.ID, &person.Name, &person.Email); err != nil {
			return nil, err
		}
		people = append(people, person)
	}
	return people, rows.Err()
}

func resolvePerson(tx *sql.Tx, person Person) (Person, error) {
	person.Name, person.Email = strings.TrimSpace(person.Name), strings.ToLower(strings.TrimSpace(person.Email))
	if person.ID != "" {
		err := tx.QueryRow(`SELECT id,name,email FROM people WHERE id=?`, person.ID).Scan(&person.ID, &person.Name, &person.Email)
		return person, err
	}
	if person.Name == "" || len(person.Name) > 200 || len(person.Email) > 320 || strings.ContainsAny(person.Name, "\r\n") {
		return person, fmt.Errorf("save person: enter a name of 1–200 characters and a valid email")
	}
	if person.Email != "" {
		err := tx.QueryRow(`SELECT id,name,email FROM people WHERE email=?`, person.Email).Scan(&person.ID, &person.Name, &person.Email)
		if err != sql.ErrNoRows {
			return person, err
		}
	}
	return insertPerson(tx, person)
}

func insertPerson(tx *sql.Tx, person Person) (Person, error) {
	id, err := newID()
	if err != nil {
		return person, err
	}
	person.ID = id
	_, err = tx.Exec(`INSERT INTO people(id,name,email) VALUES (?,?,?)`, person.ID, person.Name, person.Email)
	return person, err
}
