package meetinglang

import "strings"

const DefaultCode = "en_US"

var names = map[string]string{
	"en_US": "English",
	"en_GB": "English",
	"es_ES": "Spanish",
	"es_MX": "Spanish",
	"fr_FR": "French",
	"de_DE": "German",
	"it_IT": "Italian",
	"pt_BR": "Portuguese",
	"ja_JP": "Japanese",
	"ko_KR": "Korean",
	"zh_CN": "Chinese",
	"zh_TW": "Chinese",
}

func Normalize(code string) string {
	code = strings.TrimSpace(code)
	if code == "" {
		return DefaultCode
	}
	return code
}

func Name(code string) string {
	if name := names[Normalize(code)]; name != "" {
		return name
	}
	return Normalize(code)
}
