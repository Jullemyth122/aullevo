import { fileMatchesField } from './src/utils/fileMatch';
import { FormField } from './src/types';

const field1: FormField = {
    id: "avatar",
    name: "avatar",
    type: "file",
    placeholder: "",
    label: "Profile Photo",
    ariaLabel: "",
    autocomplete: "",
    required: false,
    context: "",
    section: "",
    accept: "image/*",
    multiple: true
};

const sf1 = {
    name: "profile (1).jpg",
    type: "image/jpeg"
};

console.log("Profile photo matched?: ", fileMatchesField(field1, sf1));

const field2: FormField = {
    id: "attachments",
    name: "attachments",
    type: "file",
    placeholder: "",
    label: "Attachments",
    ariaLabel: "",
    autocomplete: "",
    required: false,
    context: "",
    section: "",
    accept: "*/*",
    multiple: true
};

const sf2 = {
    name: "attachments (2).jfif",
    type: "image/jpeg"
};

import { fileKeywords, fieldKeywords, acceptMatchesFile } from './src/utils/fileMatch';
console.log("fieldKws:", fieldKeywords(field2));
console.log("fileKws:", fileKeywords(sf2.name));
console.log("Accept match:", acceptMatchesFile(field2.accept!, sf2.name, sf2.type));
console.log("Attachments matched?: ", fileMatchesField(field2, sf2));
console.log("Profile Photo matched Attachments file?: ", fileMatchesField(field1, sf2));
